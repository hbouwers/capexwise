/**
 * The integration suite's database: which one, how it comes to exist, and how it
 * is emptied between tests.
 *
 * This is one of the files ESLint allows to import `pg` and the driver directly,
 * and the reason is not convenience. Tests have to be able to see what the
 * application cannot: #27's cross-org isolation test proves that a scoped handle
 * hides another org's rows, and a test that can only see through the scoped
 * handle cannot tell "correctly hidden" from "never inserted". So the harness
 * holds the unscoped connection and the tests assert against it. `eslint.config.mjs`
 * names this file for that reason.
 *
 * Nothing here is imported by application code. It exists only under Vitest.
 */
import { existsSync } from "node:fs";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

import { closeDb } from "@/db/client";
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
 * The same string, exported, so a test can point a module that reads
 * `DATABASE_URL` at the test database rather than at the developer's own.
 * `src/server/auth.integration.test.ts` is why it exists: the provider builds
 * its handle from `@/server/env`, and without this it would run happily against
 * whatever `.env.local` names — and truncate it between tests.
 */
export const testDatabaseUrl = url;

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
 * Creates the test database if it is not there, then applies the committed
 * migrations to it. Runs once per Vitest run, from `global-setup.ts`.
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
 * Empties every table, called before each test. The tables are discovered rather
 * than listed, so a migration that adds one is covered by this the day it lands
 * and nobody has to remember. Drizzle's own bookkeeping table lives in the
 * `drizzle` schema, so restricting to `public` leaves the migration history
 * alone — truncating that would make the next run migrate an already-migrated
 * database.
 *
 * One statement for all of them: `TRUNCATE a, b` does not care about foreign
 * keys between the tables it is given, where a table at a time would fail on
 * whichever order the dependencies disagree with. `CASCADE` covers a reference
 * from outside the list, and `RESTART IDENTITY` resets sequences so a test that
 * asserts on a generated number does not depend on how many ran before it.
 */
export async function truncateAll(): Promise<void> {
  if (!open) return;

  const { client } = open;

  const { rows } = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  );

  if (rows.length === 0) return;

  const tables = rows
    .map((row) => client.escapeIdentifier(row.tablename))
    .join(", ");

  await client.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

/** For the failure messages of tests that need to say where they ran. */
export const testDatabaseTarget = describeTarget(url);
