/**
 * The integration suite's database: which one, how it comes to exist, and how it
 * is emptied between tests.
 *
 * This is one of the files ESLint allows to import `pg` and the driver directly,
 * and the reason is not convenience. Tests have to be able to see what the
 * application cannot: #27's cross-org isolation test proves that one org's paths
 * cannot reach another org's rows, and a test that can only see through those
 * paths cannot tell "correctly hidden" from "never inserted". So the harness
 * holds the unscoped connection and the tests assert against it. `eslint.config.mjs`
 * names this file for that reason.
 *
 * Nothing here is imported by application code. It exists only under Vitest.
 */
import { existsSync } from "node:fs";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

import { closeDb, db as applicationDb } from "@/db/client";
import * as schema from "@/db/schema";
import { parseEnv, testEnvSchema } from "@/lib/env-schema.mts";

/**
 * The local compose database with `_test` on the end. This is a literal rather
 * than something derived from `DATABASE_URL`, and that is the safety property:
 * deriving would follow whatever `DATABASE_URL` points at, so a developer whose
 * `.env.local` is aimed at a shared database would have the suite create and
 * truncate tables next to it. The default is local or it is nothing.
 *
 * The credentials are the ones `docker-compose.yml` commits, for the same reason
 * `.env.example` commits them: the database is loopback-only and holds no real
 * data. CI overrides the whole string through `TEST_DATABASE_URL`.
 */
const LOCAL_DEFAULT =
  "postgresql://capexwise:capexwise_local_dev@127.0.0.1:5432/capexwise_test";

/**
 * The suffix every test database name must carry. This is the guard that makes
 * `TRUNCATE` in `truncateAll` safe to run unattended: the one catastrophic
 * version of this file is the one that empties a database somebody cared about,
 * and a `TEST_DATABASE_URL` pointing at `capexwise` rather than `capexwise_test`
 * — a copy-paste from `.env.example`, most likely — is exactly how that happens.
 */
const REQUIRED_SUFFIX = "_test";

// Vitest is a plain Node process and loads no env files on its own, so an
// override placed in `.env.local` is read here. Same call and same reason as
// `src/db/migrate.mts`, which explains it at length.
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const { TEST_DATABASE_URL: url } = parseEnv(
  testEnvSchema,
  { TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? LOCAL_DEFAULT },
  "It is optional: unset, the suite uses the local compose database with " +
    "`_test` appended, which `npm run db:up` provides.",
);

/**
 * The role the application's pool logs in as under test, and deliberately not
 * the superuser the harness itself connects as.
 *
 * A superuser skips row-level security outright, `FORCE` or no `FORCE`, so a
 * suite that ran the application as one would pass whether or not a single
 * policy existed — and the identity path would never once be read through the
 * policies that are supposed to let it in. This role has the shape of
 * production's `capexwise_app` login (ADR-0007, #81): not the owner, no
 * `BYPASSRLS`, a member of `capexwise_identity` for sign-in and able to become
 * `capexwise_scoped` for everything else. A change to one is a change to both. If Better Auth reaches for a table the identity role was not
 * granted, `src/server/auth.integration.test.ts` is where that surfaces.
 *
 * The password is the compose file's committed local credential, for the reason
 * that file gives: loopback only, and nothing behind it worth having.
 */
const APPLICATION_ROLE = "capexwise_test_app";
const APPLICATION_PASSWORD = "capexwise_local_dev";

function asApplicationRole(connectionString: string): string {
  const application = new URL(connectionString);
  application.username = APPLICATION_ROLE;
  application.password = APPLICATION_PASSWORD;

  return application.toString();
}

/**
 * The test database, as the application's login role. A test sets `DATABASE_URL`
 * to this so that a module reading it — `@/server/auth`, `@/server/org-context` —
 * reaches the disposable database rather than whatever `.env.local` names, and
 * reaches it as the application rather than as the harness.
 * `src/server/auth.integration.test.ts` is why the first half exists: without
 * it the provider would run happily against the developer's own database, and
 * the suite would truncate it between tests.
 */
export const applicationDatabaseUrl = asApplicationRole(url);

/**
 * The connection string carries a password, so — as everywhere else that touches
 * one — errors name the host and database and never the string itself.
 */
function describeTarget(connectionString: string): string {
  const { host, pathname } = new URL(connectionString);
  return `${host}${pathname}`;
}

/**
 * Splits the connection string into the database it names and a string for the
 * same server's `postgres` maintenance database, which is where `CREATE DATABASE`
 * has to be issued from — you cannot create a database from inside itself.
 *
 * `URL` is enough here in a way it is not in `env-schema.mts`. That module has to
 * accept the Cloud SQL unix-socket form, which `URL` rejects outright; this one
 * only ever sees a TCP string a developer or CI set for a throwaway database, and
 * needs to take it apart rather than merely recognise it.
 */
function split(connectionString: string): {
  database: string;
  maintenance: string;
} {
  let parsed: URL;

  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error(
      "TEST_DATABASE_URL could not be parsed as a URL. The test harness has " +
        "to take the string apart to find the database name, so the unix-socket " +
        "form the application accepts does not work here — use a host and port.",
    );
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));

  const maintenance = new URL(connectionString);
  maintenance.pathname = "/postgres";

  return { database, maintenance: maintenance.toString() };
}

const { database, maintenance } = split(url);

if (!database.endsWith(REQUIRED_SUFFIX)) {
  throw new Error(
    `TEST_DATABASE_URL names the database \`${database}\`, which does not end ` +
      `in \`${REQUIRED_SUFFIX}\`. The integration suite truncates every table ` +
      `in the database it is pointed at, so it refuses to run against one that ` +
      `is not obviously disposable. Append the suffix, or leave the variable ` +
      `unset to use the local default.`,
  );
}

/**
 * Creates the test database if it is not there, applies the committed
 * migrations to it, and makes sure the application's login role exists. Runs
 * once per Vitest run, from `global-setup.ts`.
 *
 * Migrating rather than dropping and recreating: the migrations are the schema,
 * the drift check (`npm run db:drift`) is what keeps them honest, and a suite
 * that built its tables any other way would pass against a schema production
 * never sees.
 */
export async function ensureTestDatabase(): Promise<void> {
  const admin = new Client({ connectionString: maintenance });
  await admin.connect();

  try {
    // No `IF NOT EXISTS` for CREATE DATABASE in Postgres, so the already-there
    // case is the error code rather than a check — and it has to be, because a
    // check followed by a create is a race between two runs on one machine.
    await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(database)}`);
  } catch (error) {
    // 42P04 is duplicate_database, which is the normal case on every run after
    // the first. Anything else is real.
    if ((error as { code?: string }).code !== "42P04") throw error;
  } finally {
    await admin.end();
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });

    // After the migrations, because the two roles granted here are theirs.
    // Roles belong to the server rather than the database, so this survives
    // between runs and is created only once; the grants are re-applied every
    // time, which is a notice rather than an error when nothing changed.
    //
    // The same two grants the migration gives the role that runs it, and for
    // the same reasons — `drizzle/0006_row_level_security.sql` explains the
    // INHERIT and SET on each.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APPLICATION_ROLE}') THEN
          CREATE ROLE ${APPLICATION_ROLE}
            LOGIN PASSWORD '${APPLICATION_PASSWORD}' NOBYPASSRLS;
        END IF;
      END
      $$
    `);
    await client.query(
      `GRANT capexwise_identity TO ${APPLICATION_ROLE} WITH INHERIT TRUE, SET FALSE`,
    );
    await client.query(
      `GRANT capexwise_scoped TO ${APPLICATION_ROLE} WITH INHERIT FALSE, SET TRUE`,
    );
  } finally {
    await client.end();
  }
}

let open: { client: Client; db: NodePgDatabase<typeof schema> } | undefined;

/**
 * One connection per test file, opened in `setup-integration.ts`. Not a pool: a
 * file's tests run serially, so a pool would add a lease step and the chance of
 * two of its connections disagreeing about an open transaction, and buy nothing.
 */
export async function openTestConnection(): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();

  open = { client, db: drizzle(client, { schema }) };
}

export async function closeTestConnection(): Promise<void> {
  // The application's own pool, which is normally never opened here: only a test
  // that exercises a module reaching for `@/db/client` — `src/server/auth.ts` is
  // the one so far — causes one to exist. `closeDb()` is a no-op otherwise, and
  // closing it from the harness rather than from that test is what keeps
  // `@/db/client` out of the ESLint allowlist for a test file.
  await closeDb();

  if (!open) return;

  const { client } = open;
  open = undefined;

  // Without this the Vitest process hangs on the open socket after the last
  // test — the same failure `src/db/migrate.mts` guards against.
  await client.end();
}

/**
 * The database handle for the current test file. A function rather than an
 * exported binding because the connection does not exist at import time, and a
 * binding captured then would be `undefined` forever.
 */
export function testDb(): NodePgDatabase<typeof schema> {
  if (!open) {
    throw new Error(
      "There is no test database connection. `testDb()` works only inside the " +
        "`integration` project, which is what loads `src/test/setup-integration.ts` " +
        "— a `*.test.ts` file cannot use it, only a `*.integration.test.ts` one.",
    );
  }

  return open.db;
}

/**
 * The **application's** pooled handle — the one `@/db/client` builds and
 * `@/server/org-context` runs its transactions through. Not `testDb()`, which is
 * this file's own separate connection.
 *
 * It exists for one test and the distinction is the whole point of that test.
 * `forOrg().run()` sets `app.current_org_id` with `SET LOCAL`, and the claim
 * worth checking is that the setting is gone once the transaction commits — that
 * the *next request* handed the same pooled connection does not inherit it,
 * which ADR-0003 calls the exact breach the layer exists to prevent. Asking that
 * question through `testDb()` would answer a different one, because a separate
 * connection never had the setting to begin with and would report "unset" no
 * matter what `forOrg()` did.
 *
 * Reached from here rather than by importing `@/db/client` in the test, because
 * this file is on the ESLint allowlist and a test file is not — and it should
 * stay that way. Callers must set `DATABASE_URL` to `applicationDatabaseUrl`
 * before the first call, which is what points the pool at the disposable
 * database.
 */
export const appDb = applicationDb;

/**
 * The tables a migration fills rather than a test: reference data, which every
 * org reads and nothing in the product writes (`docs/data-model.md` §6).
 * `truncateAll` leaves them alone, because the migrations run once per suite
 * and nothing would put the rows back — every test after the first would find
 * no trades to tag anybody with.
 *
 * Listed rather than discovered, and the isolation test holds the list to what
 * it claims: each table on it is outside the boundary, readable by the scoped
 * role and writable by nobody but a migration. A test that writes to one of
 * these would leak into every test after it, and none should.
 */
export const REFERENCE_TABLES: readonly string[] = [
  "trade_tags",
  "capital_item_types",
  "schedule_e_categories",
];

/**
 * Empties every table but the reference data, called before each test. The
 * tables are discovered rather than listed, so a migration that adds one is
 * covered by this the day it lands and nobody has to remember. Drizzle's own
 * bookkeeping table lives in the `drizzle` schema, so restricting to `public`
 * leaves the migration history alone — truncating that would make the next run
 * migrate an already-migrated database.
 *
 * One statement for all of them: `TRUNCATE a, b` does not care about foreign
 * keys between the tables it is given, where a table at a time would fail on
 * whichever order the dependencies disagree with. `CASCADE` covers a reference
 * from outside the list, and `RESTART IDENTITY` resets sequences so a test that
 * asserts on a generated number does not depend on how many ran before it.
 *
 * `CASCADE` also empties whatever references a table it is given, never what
 * that table references, so emptying `contact_tags` leaves the trades it
 * points at in place.
 */
export async function truncateAll(): Promise<void> {
  if (!open) return;

  const { client } = open;

  const { rows } = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT (tablename = ANY ($1))",
    [REFERENCE_TABLES],
  );

  if (rows.length === 0) return;

  const tables = rows
    .map((row) => client.escapeIdentifier(row.tablename))
    .join(", ");

  await client.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

/** For the failure messages of tests that need to say where they ran. */
export const testDatabaseTarget = describeTarget(url);
