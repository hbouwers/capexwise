/**
 * The nightly backup, and the restore drill that makes it one (#35, ADR-0010).
 *
 *   npm run db:backup -- <file>
 *
 * Three steps, and the command fails if any of them does:
 *
 * 1. **Dump** `BACKUP_SOURCE_URL` to `<file>` in Postgres's custom format.
 * 2. **Restore** that file into `BACKUP_RESTORE_URL`, a database this drops and
 *    recreates, from nothing, and time how long it takes.
 * 3. **Compare** the restored database with what was dumped: every table's row
 *    count, and the row-level security that came back with them.
 *
 * An untested backup is a belief, not a backup, which is #35's point. So nothing
 * leaves this command as a backup unless it has just been restored.
 *
 * It does not encrypt or upload. The file it writes is plaintext and belongs to
 * the caller: `.github/workflows/backup.yml` encrypts it before it goes anywhere,
 * and deletes it with the runner.
 *
 * `pg_dump` and `pg_restore` come from the PATH and have to be Postgres 18's or
 * newer, because `pg_dump` refuses a server newer than itself. The workflow
 * installs them, and `docs/runbooks/backup-and-restore.md` says how to run this
 * locally.
 *
 * On the ESLint allowlist for the migration runner's reason: it opens its own
 * connections, to databases the application never connects to, and acts for no
 * org.
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, rmSync, writeFileSync } from "node:fs";

import { Client } from "pg";

import {
  backupEnvSchema,
  EnvironmentError,
  parseEnv,
} from "../lib/env-schema.mts";

// A plain Node process loads no env files, so `.env.local` is read here — the
// same call as `src/db/migrate.mts`, for the same reason.
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

/**
 * The schemas backed up: the application's, and Drizzle's bookkeeping, so that a
 * restored database knows which migrations it has had. Named rather than left
 * to `pg_dump`'s default of everything, because a provider is free to put
 * schemas of its own in the database, and a schema the reader cannot read would
 * fail the dump.
 */
const SCHEMAS = ["public", "drizzle"];

/**
 * Tables whose definitions are backed up and whose rows are not, and why. Each
 * is a table whose rows are worth nothing after a restore and would be a
 * liability in a file that outlives the incident that needed it.
 */
const WITHOUT_ROWS: Record<string, string> = {
  "public.sessions":
    "Live sign-ins. A restored database should sign everyone out, and until they expire these are credentials in a file.",
  "public.verifications":
    "Single-use OAuth state, useless minutes after it is written.",
  "public.rate_limits": "Counters that reset themselves.",
};

/**
 * The suffix a restore target's name must carry. The command drops that
 * database before every restore, so it refuses one that is not obviously
 * disposable — the guard `src/test/db.ts` puts on `_test`, for the same reason.
 */
const REQUIRED_SUFFIX = "_restore";

let sourceUrl: string;
let restoreUrl: string;

try {
  ({ BACKUP_SOURCE_URL: sourceUrl, BACKUP_RESTORE_URL: restoreUrl } = parseEnv(
    backupEnvSchema,
    process.env,
    "The backup workflow sets both. To run it locally, " +
      "docs/runbooks/backup-and-restore.md says what to point them at.",
  ));
} catch (error) {
  if (!(error instanceof EnvironmentError)) throw error;

  console.error(error.message);
  process.exit(1);
}

const file = process.argv[2] || usage();

function usage(): never {
  console.error(
    "Usage: npm run db:backup -- <file>\n\n" +
      "The dump is written to <file>, unencrypted. Choose a path that is not " +
      "inside the repository.",
  );
  process.exit(1);
}

/**
 * Parses a connection string once, here, so that nothing below calls `new URL`
 * on a raw one. Node's error for a string it cannot parse carries the string,
 * password and all, and prints it with the stack — into a workflow log that
 * goes public with the repository. This names the variable instead, as the
 * integration harness's `split()` does for the same reason.
 *
 * Two shapes pass the schema's check and fail here: a password with an
 * unescaped `/`, `@` or `#` in it, and the unix-socket form the application
 * accepts for Cloud SQL, which has no host.
 */
function parseConnection(name: string, value: string): URL {
  try {
    return new URL(value);
  } catch {
    console.error(
      `${name} could not be parsed as a URL. It has to be the host form, ` +
        "postgresql://user:password@host:port/database, with any special " +
        "character in the password percent-encoded. The unix-socket form the " +
        "application accepts does not work here.",
    );
    process.exit(1);
  }
}

const source = parseConnection("BACKUP_SOURCE_URL", sourceUrl);
const target = parseConnection("BACKUP_RESTORE_URL", restoreUrl);

// Both checked before anything connects, so that a misconfigured run fails
// in a second rather than after a dump.
const restoreDatabase = decodeURIComponent(target.pathname.replace(/^\//, ""));

if (!restoreDatabase.endsWith(REQUIRED_SUFFIX)) {
  console.error(
    `BACKUP_RESTORE_URL names the database \`${restoreDatabase}\`, which does ` +
      `not end in \`${REQUIRED_SUFFIX}\`. The restore drops that database ` +
      "first, so it refuses one that is not obviously disposable.",
  );
  process.exit(1);
}

// Neon's pooled endpoint is pgbouncer in transaction mode, where a
// transaction's snapshot cannot be shared with a second session. The direct
// endpoint is the same database without the pooler, and the migration job's
// credential is one for a similar reason (README, "Applying migrations").
if (source.hostname.includes("-pooler")) {
  console.error(
    "BACKUP_SOURCE_URL names Neon's pooled endpoint. pg_dump needs a session " +
      "of its own: use the host without -pooler in it.",
  );
  process.exit(1);
}

/** Host and database, never the whole string: it carries a password. */
function describe({ host, pathname }: URL): string {
  return `${host}${pathname}`;
}

/**
 * A connection string split for a child process: the string without its
 * password, for the command line, and the password for its environment. A
 * command line is what an error report prints when a process fails to start.
 */
function forChild(connection: URL): {
  dbname: string;
  env: Record<string, string>;
} {
  // A copy, so that clearing the password here leaves the caller's intact.
  const url = new URL(connection);
  const password = decodeURIComponent(url.password);
  url.password = "";

  return {
    dbname: url.toString(),
    env: {
      PGAPPNAME: "capexwise-backup",
      ...(password ? { PGPASSWORD: password } : {}),
    },
  };
}

/**
 * Runs one of Postgres's own tools, waits for it, and returns what it wrote to
 * stdout. Its errors go straight to this process's stderr, so a `pg_dump` or
 * `pg_restore` failure is printed in its own words. `--no-password` on every
 * call keeps a missing password a failure rather than a prompt nobody is there
 * to answer.
 */
function run(
  command: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["--no-password", ...args], {
      stdio: ["ignore", "pipe", "inherit"],
      env: { ...process.env, ...env },
    });

    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));

    // Constructed here rather than passed on, because Node's own error for a
    // process that failed to start carries its arguments.
    child.on("error", (error: NodeJS.ErrnoException) =>
      reject(
        new Error(
          `Could not start ${command} (${error.code}). It has to be on the ` +
            "PATH, and from Postgres 18 or newer.",
        ),
      ),
    );

    // `close` rather than `exit`: it waits for stdout to drain as well.
    child.on("close", (code, signal) =>
      code === 0
        ? resolve(stdout)
        : reject(
            new Error(`${command} failed, exiting with ${code ?? signal}.`),
          ),
    );
  });
}

/** What the comparison looks at, read the same way on both sides. */
type Contents = {
  /** Every table in `SCHEMAS`, schema-qualified, with its row count. */
  rows: Record<string, number>;
  /**
   * Row-level security, its policies, and every grant on a table, sequence or
   * schema to anyone but the object's owner — the second layer ADR-0003 relies
   * on. A restore that brought the rows back without it would be a production
   * database with one of its two layers missing, and nothing would say so.
   * Owners are left out because a restore gives everything a new one.
   */
  security: string[];
  /**
   * Every role a grant or a policy names. Roles belong to the server rather
   * than the database, so a dump does not carry them, and a policy naming a role
   * that does not exist fails the restore.
   */
  roles: string[];
};

async function inspect(client: Client): Promise<Contents> {
  const { rows: tables } = await client.query<{ name: string }>(
    `select format('%I.%I', n.nspname, c.relname) as name
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and n.nspname = any ($1)
     order by 1`,
    [SCHEMAS],
  );

  const rows: Record<string, number> = {};

  for (const { name } of tables) {
    // `name` came out of `format('%I')`, so it is quoted already.
    const { rows: counted } = await client.query<{ count: string }>(
      `select count(*) as count from ${name}`,
    );

    rows[name] = Number(counted[0]?.count);
  }

  const { rows: security } = await client.query<{ line: string }>(
    `select format('%I.%I: row security %s%s', n.nspname, c.relname,
                   case when c.relrowsecurity then 'enabled' else 'disabled' end,
                   case when c.relforcerowsecurity then ', forced' else '' end) as line
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and n.nspname = any ($1)

     union all

     select format('%I.%I: policy %I %s to %s using %s with check %s',
                   schemaname, tablename, policyname, cmd,
                   array_to_string(roles, ', '), qual, with_check)
     from pg_policies
     where schemaname = any ($1)

     union all

     select format('%I.%I: %s to %s', n.nspname, c.relname, a.privilege_type,
                   case when a.grantee = 0 then 'public'
                        else pg_get_userbyid(a.grantee) end)
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(c.relacl) a
     where c.relkind in ('r', 'p', 'S') and n.nspname = any ($1)
       and a.grantee <> c.relowner

     union all

     select format('schema %I: %s to %s', n.nspname, a.privilege_type,
                   case when a.grantee = 0 then 'public'
                        else pg_get_userbyid(a.grantee) end)
     from pg_namespace n
     cross join lateral aclexplode(n.nspacl) a
     where n.nspname = any ($1) and a.grantee <> n.nspowner

     order by 1`,
    [SCHEMAS],
  );

  const { rows: roles } = await client.query<{ role: string }>(
    `select pg_get_userbyid(a.grantee) as role
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(c.relacl) a
     where n.nspname = any ($1) and a.grantee not in (0, c.relowner)

     union

     select pg_get_userbyid(a.grantee)
     from pg_namespace n
     cross join lateral aclexplode(n.nspacl) a
     where n.nspname = any ($1) and a.grantee not in (0, n.nspowner)

     union

     select unnest(roles)::text
     from pg_policies
     where schemaname = any ($1)

     order by 1`,
    [SCHEMAS],
  );

  return {
    rows,
    security: security.map((row) => row.line),
    roles: roles.map((row) => row.role).filter((role) => role !== "public"),
  };
}

/**
 * Every table with row-level security that the connected login cannot read in
 * full: no `select` or `for all` policy of `using (true)` applies to it. Empty
 * for the reader, which `drizzle/0007` and the §9 template give one on every
 * such table.
 *
 * This is the one failure the restore cannot catch. A table the policies hide
 * is dumped empty, restored empty, and counted empty on both sides, because both
 * sides are read as the reader. The isolation test refuses such a table on the
 * pull request that adds it. This refuses it in production, where a policy
 * dropped by hand would otherwise go unnoticed until the backup was needed.
 *
 * It says nothing about a superuser, which counts as a member of every role and
 * reads past the policies anyway. Its dump is complete, and this finds nothing.
 */
async function unreadable(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `select format('%I.%I', n.nspname, c.relname) as name
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and c.relrowsecurity
       and n.nspname = any ($1)
       and not exists (
         select from pg_policies p
         where p.schemaname = n.nspname and p.tablename = c.relname
           and p.permissive = 'PERMISSIVE'
           and p.cmd in ('SELECT', 'ALL') and p.qual = 'true'
           and exists (
             select from unnest(p.roles) as r (name)
             where case when r.name = 'public' then true
                        else pg_has_role(current_user, r.name, 'usage') end
           )
       )
     order by 1`,
    [SCHEMAS],
  );

  return rows.map((row) => row.name);
}

/**
 * Dumps the source and reads its contents, both from one snapshot.
 *
 * The snapshot is what lets the comparison be exact. The counts are taken in a
 * transaction that exports its snapshot, and `pg_dump` is handed that snapshot
 * rather than taking its own, so a write that lands while the dump runs is
 * invisible to both. Without it, one sign-in during the backup would be a
 * mismatch, and a nightly job that fails for no reason teaches everyone to
 * ignore it.
 *
 * `--enable-row-security` because the source login is not allowed past the
 * policies. Without the flag, `pg_dump` turns row security off for its session
 * and then fails on every table that has any, unless the login bypasses it —
 * which on Neon nothing we log in as does. With it, what is dumped is what the
 * reader's policies admit, which `drizzle/0007` makes every row. The counts
 * above are read through the same policies, so they agree with the dump by
 * construction — which is why `unreadable()` runs first.
 */
async function dump(): Promise<{ contents: Contents; seconds: number }> {
  const reader = new Client({ connectionString: sourceUrl });
  await reader.connect();

  try {
    const hidden = await unreadable(reader);

    if (hidden.length > 0) {
      throw new Error(
        "The backup login cannot see every row of " +
          `${hidden.join(", ")}: no policy on each admits it with ` +
          "`using (true)`, so the dump would hold it empty and the restore " +
          "would agree. The template is in docs/data-model.md §9.",
      );
    }

    await reader.query(
      "begin transaction isolation level repeatable read, read only",
    );

    const { rows } = await reader.query<{ snapshot: string }>(
      "select pg_export_snapshot() as snapshot",
    );
    const snapshot = rows[0]?.snapshot;

    if (!snapshot) throw new Error("The source exported no snapshot.");

    const contents = await inspect(reader);
    const { dbname, env } = forChild(source);
    const started = performance.now();

    await run(
      "pg_dump",
      [
        "--dbname",
        dbname,
        "--format",
        "custom",
        "--file",
        file,
        "--snapshot",
        snapshot,
        "--enable-row-security",
        // A migration holding a lock would otherwise stall the dump until the
        // job's own timeout, which fails later and says less.
        "--lock-wait-timeout",
        "60s",
        ...SCHEMAS.flatMap((schema) => ["--schema", schema]),
        ...Object.keys(WITHOUT_ROWS).flatMap((table) => [
          "--exclude-table-data",
          table,
        ]),
      ],
      env,
    );

    const seconds = (performance.now() - started) / 1000;

    await reader.query("commit");

    return { contents, seconds };
  } finally {
    await reader.end();
  }
}

/**
 * Restores the dump into a database created for it, the way a real restore
 * would start: an empty database with the roles the dump names, and nothing
 * else.
 *
 * `--single-transaction` with `--exit-on-error`, so a restore either completes
 * or leaves nothing behind. `--no-owner` because the owner the dump names is
 * production's and need not exist here; everything restored belongs to the
 * login doing the restoring, which is also what happens on a fresh Neon
 * project. The grants and policies are kept, and the comparison checks that
 * they came back.
 */
async function restore(
  roles: string[],
): Promise<{ contents: Contents; seconds: number }> {
  // `CREATE DATABASE` has to be issued from another database on the same
  // server, and `postgres` is the one every server has.
  const maintenance = new URL(target);
  maintenance.pathname = "/postgres";

  const admin = new Client({ connectionString: maintenance.toString() });
  await admin.connect();

  try {
    const name = admin.escapeIdentifier(restoreDatabase);

    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.query(`create database ${name}`);

    // NOLOGIN, whatever the role is in production: the restored database is
    // only ever read by this command, and a role that exists already, from an
    // earlier run, is left as it is.
    for (const role of roles) {
      const { rowCount } = await admin.query(
        "select 1 from pg_roles where rolname = $1",
        [role],
      );

      if (!rowCount) {
        await admin.query(
          `create role ${admin.escapeIdentifier(role)} nologin`,
        );
      }
    }
  } finally {
    await admin.end();
  }

  // Every database already has a `public` schema, and a dump that names
  // `--schema public` carries a `CREATE SCHEMA public` that fails against it.
  // So the restore runs from the dump's own table of contents with that one
  // entry taken out — the rest of what the dump says about `public`, its grants
  // included, still applies. `docs/runbooks/backup-and-restore.md` restores
  // production the same way, and for the same reason.
  const toc = await run("pg_restore", ["--list", file]);
  const list = `${file}.list`;

  writeFileSync(
    list,
    toc
      .split("\n")
      .filter((entry) => !/ SCHEMA - public /.test(entry))
      .join("\n"),
  );

  const { dbname, env } = forChild(target);
  const started = performance.now();

  try {
    await run(
      "pg_restore",
      [
        "--dbname",
        dbname,
        "--single-transaction",
        "--exit-on-error",
        "--no-owner",
        "--use-list",
        list,
        file,
      ],
      env,
    );
  } finally {
    rmSync(list, { force: true });
  }

  const seconds = (performance.now() - started) / 1000;

  const restored = new Client({ connectionString: restoreUrl });
  await restored.connect();

  try {
    return { contents: await inspect(restored), seconds };
  } finally {
    await restored.end();
  }
}

/**
 * Every way the restored database differs from what was dumped, as sentences.
 * Empty means the drill passed.
 *
 * Row counts are compared and never printed. This output lands in a workflow
 * log that goes public with the repository at v0.5, and a count of rows in
 * `organizations` is a count of customers.
 */
function differences(dumped: Contents, restored: Contents): string[] {
  const found: string[] = [];
  const tables = new Set([
    ...Object.keys(dumped.rows),
    ...Object.keys(restored.rows),
  ]);

  for (const table of [...tables].sort()) {
    const before = dumped.rows[table];
    const after = restored.rows[table];

    if (before === undefined) {
      found.push(`${table} was restored but never dumped.`);
    } else if (after === undefined) {
      found.push(`${table} was dumped and did not come back.`);
    } else if (table in WITHOUT_ROWS) {
      if (after !== 0) found.push(`${table} should have come back empty.`);
    } else if (after !== before) {
      found.push(
        `${table} came back with ${after < before ? "fewer" : "more"} rows ` +
          "than were dumped.",
      );
    }
  }

  const restoredSecurity = new Set(restored.security);
  const dumpedSecurity = new Set(dumped.security);

  for (const line of dumped.security) {
    if (!restoredSecurity.has(line)) found.push(`Missing: ${line}`);
  }

  for (const line of restored.security) {
    if (!dumpedSecurity.has(line)) found.push(`Not in the source: ${line}`);
  }

  return found;
}

async function main(): Promise<void> {
  console.log(`Dumping ${describe(source)} ...`);
  const dumped = await dump();

  console.log(`Restoring into ${describe(target)} ...`);
  const restored = await restore(dumped.contents.roles);

  const found = differences(dumped.contents, restored.contents);
  const tableCount = Object.keys(dumped.contents.rows).length;

  const report = [
    found.length === 0
      ? `**Restored and matched.** ${tableCount} tables and their row-level security came back as they were dumped.`
      : "**The restore does not match the dump.**",
    "",
    "| Step | Time |",
    "| --- | --- |",
    `| Dump | ${dumped.seconds.toFixed(1)} s |`,
    `| Restore | ${restored.seconds.toFixed(1)} s |`,
    "",
    `Backed up without their rows: ${Object.keys(WITHOUT_ROWS).join(", ")}.`,
    ...(found.length > 0 ? ["", ...found.map((line) => `- ${line}`)] : []),
  ].join("\n");

  console.log(`\n${report}`);

  // The workflow's run page shows this, so the drill's time is on the page
  // rather than in a log somebody has to open.
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  }

  if (found.length > 0) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
