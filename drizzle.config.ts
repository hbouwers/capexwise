import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

/**
 * `generate` and the drift check are purely file-based — they compare the
 * TypeScript schema against the snapshots in `drizzle/meta`, never against a
 * live database. That is deliberate: it lets CI verify a migration is checked
 * in without provisioning Postgres for the job.
 *
 * So `dbCredentials` must not be required to load this file, and this is the one
 * place in the repository that reads `process.env` without validating it. That
 * is the whole exception rather than a precedent: `drizzle-kit studio` is the
 * only subcommand here that connects, and it fails on its own with a connection
 * error that is hard to misread. Everything that needs a value it can rely on
 * goes through `src/lib/env-schema.mts` — `src/db/migrate.mts` for the migration
 * runner, `src/server/env.ts` for the application.
 */
// Next.js loads `.env.local` for the application; drizzle-kit is a separate
// process and loads nothing, so it is read here. `process.loadEnvFile` throws
// on a missing file, and a missing file is the normal case in CI.
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

export default defineConfig({
  dialect: "postgresql",
  // A glob rather than the bare directory, because the integration tests are
  // colocated with the tables they cover and drizzle-kit `require`s every `.ts`
  // file it is pointed at. A test file imports `vitest`, which cannot be
  // `require`d — the load throws, drizzle-kit prints the error and exits 0
  // anyway, and the schema it then diffs against is empty. `!(*.test)` excludes
  // `*.integration.test.ts` and `*.test.ts` alike. Still a glob over the
  // directory rather than a list of files, so a new table is picked up by
  // existing rather than by being remembered here.
  schema: "./src/db/schema/**/!(*.test).ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});

// Two options are deliberately absent.
//
// `casing: "snake_case"` would derive column names from the TypeScript property
// names, so the schema could say `createdAt` and mean `created_at`. It has to be
// set identically here and on every runtime client, and if the two ever disagree
// the generated DDL and the live queries reference different column names.
// Column names are written out instead — verbose beats silently divergent.
//
// `strict` and `verbose` only shape `drizzle-kit push`, which ADR-0006 rules out
// entirely: it applies a diff with no migration file and no history. Setting
// them would imply push is on the table.
