/**
 * Applies the committed migrations in `drizzle/` and exits. This is the only
 * command in the repository that needs a database to be reachable.
 *
 * It opens its own single connection rather than importing the application's
 * client, and that is deliberate on two counts. A migration run is one session
 * doing DDL serially, so a pool is the wrong shape for it — and the role that
 * owns the tables is not necessarily the role the application connects as, which
 * matters once #28 turns on `FORCE ROW LEVEL SECURITY`. Keeping them separate
 * now means that split costs a connection string later rather than a rewrite.
 *
 * Forward-only. There is no `down`, by decision — see ADR-0006.
 *
 * `.mts` rather than `.ts` so the extension declares ESM. Node runs TypeScript
 * directly, but `package.json` has no `"type"` field, so a `.ts` file is parsed
 * as CommonJS first and reparsed with a warning on every run. Adding
 * `"type": "module"` to fix that would change module resolution for the whole
 * project to silence one warning; `tsconfig.json` already includes `.mts` files.
 *
 * Run it with `npm run db:migrate`.
 */
import { existsSync } from "node:fs";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

// Next.js loads `.env.local` for the application; this is a plain Node process
// and loads nothing, so it is read here. `.env.example` plus real boot-time
// validation is #20 — until then this is the check, and it is deliberately a
// hard failure rather than a fallback to the local compose database. A silent
// default would mean a mis-set variable in CI migrates a developer's laptop.
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const url = process.env.DATABASE_URL;

if (!url) {
  console.error(
    "DATABASE_URL is not set.\n\n" +
      "Locally: `npm run db:up`, then put the connection string from the README\n" +
      "into `.env.local`. In CI and on deploy it comes from the environment.",
  );
  process.exit(1);
}

/**
 * The connection string carries a password, so it is never logged whole — but
 * which database was just migrated is exactly the thing worth seeing in a
 * deploy log, so the safe half of it is.
 */
function describeTarget(connectionString: string): string {
  try {
    const parsed = new URL(connectionString);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "the configured database";
  }
}

async function main(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    console.log(
      `Applying migrations to ${describeTarget(connectionString)} ...`,
    );
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    console.log("Migrations applied.");
  } finally {
    // Without this the process hangs on an open socket after a successful run.
    await client.end();
  }
}

main(url).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
