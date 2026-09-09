/**
 * Fails if the Drizzle schema and the committed migrations disagree.
 *
 * The failure this catches is a change to `src/db/schema/` that ships without
 * the migration that implements it. Nothing about that is visible in review —
 * the types are right, the queries compile, and the column does not exist in
 * any database. It surfaces on deploy.
 *
 * Two checks, cheapest first:
 *
 *   drizzle-kit check      the journal and the snapshots agree with each other
 *                          (a hand-edited snapshot, a duplicated index, a
 *                          migration added on two branches at once)
 *   drizzle-kit generate   produces nothing new, which is only true when the
 *                          snapshots already describe the TypeScript schema
 *
 * Both are file-based, so this needs no database and CI does not have to
 * provision one for the job (#22).
 *
 * Anything `generate` writes is undone before exiting, so running this on a
 * work tree with real changes in it does not leave a stray migration behind.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";

const MIGRATIONS_DIR = "drizzle";

// The bin is resolved and run through this Node rather than shelled out to
// `npx`, which needs `shell: true` on Windows to find `npx.cmd` — and passing
// arguments through a shell is both a deprecation warning and a quoting bug
// waiting for the first migration name with a space in it.
// Resolved off the package main rather than as a subpath: drizzle-kit declares
// `exports`, and `bin.cjs` is not one of them.
const DRIZZLE_KIT = join(
  dirname(createRequire(import.meta.url).resolve("drizzle-kit")),
  "bin.cjs",
);

function drizzleKit(...args) {
  return spawnSync(process.execPath, [DRIZZLE_KIT, ...args], {
    encoding: "utf8",
    // stdin is closed on purpose. `generate` prompts when it cannot tell a
    // rename from a drop, and a prompt in CI is a hung job — reading EOF makes
    // it fail instead, which this script reports as drift.
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Every file under `drizzle/`, as path -> contents. */
function snapshotTree(dir) {
  const files = new Map();

  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else {
        files.set(
          relative(dir, path).replaceAll("\\", "/"),
          readFileSync(path),
        );
      }
    }
  };

  walk(dir);
  return files;
}

function digest(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function fail(message, output) {
  console.error(`\n${message}`);
  if (output?.trim()) {
    console.error(`\n${output.trim()}`);
  }
  process.exit(1);
}

const check = drizzleKit("check");
if (check.status !== 0) {
  fail(
    "The migration journal is inconsistent with its snapshots.\n" +
      "This is usually a migration added on two branches at once, or a\n" +
      "snapshot edited by hand. `drizzle-kit check` explains which.",
    `${check.stdout}${check.stderr}`,
  );
}

const before = snapshotTree(MIGRATIONS_DIR);

const generate = drizzleKit("generate", "--name", "drift_check");
const after = snapshotTree(MIGRATIONS_DIR);

const added = [...after.keys()].filter((path) => !before.has(path));
const changed = [...before.keys()].filter(
  (path) =>
    after.has(path) && digest(before.get(path)) !== digest(after.get(path)),
);

// Undo whatever `generate` wrote before deciding anything — including the case
// where it failed partway and left a file behind.
for (const path of added) {
  rmSync(join(MIGRATIONS_DIR, path));
}
for (const path of changed) {
  writeFileSync(join(MIGRATIONS_DIR, path), before.get(path));
}

if (generate.status !== 0) {
  fail(
    "`drizzle-kit generate` failed.",
    `${generate.stdout}${generate.stderr}`,
  );
}

if (added.length > 0 || changed.length > 0) {
  fail(
    "The schema in `src/db/schema/` is ahead of the committed migrations.\n\n" +
      `Generating one produced: ${[...added, ...changed].sort().join(", ")}\n\n` +
      "Run `npm run db:generate -- --name a_short_description`, review the SQL,\n" +
      "and commit it alongside the schema change.",
  );
}

console.log("Migrations are in sync with the schema.");
