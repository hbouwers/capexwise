import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

/**
 * `generate` and the drift check are purely file-based — they compare the
 * TypeScript schema against the snapshots in `drizzle/meta`, never against a
 * live database. That is deliberate: it lets CI verify a migration is checked
 * in without provisioning Postgres for the job.
 *
 * So `dbCredentials` must not be required to load this file. It is read
 * leniently here, and `src/db/migrate.ts` — the one command that genuinely
 * needs a database — does the strict check with an error that says what to do.
 * `.env.example` plus real boot-time validation is #20; this is the minimum
 * that works until then.
 */
// Next.js loads `.env.local` for the application; drizzle-kit is a separate
// process and loads nothing, so it is read here. `process.loadEnvFile` throws
// on a missing file, and a missing file is the normal case in CI.
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema",
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
