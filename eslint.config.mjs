import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

/**
 * An unscoped database handle is how a query ships without an `org_id` filter,
 * which is the one failure this codebase cannot recover from — see ADR-0003.
 *
 * There are three ways to get one and all three are closed here. The first is
 * `@/db/client`, the module that holds the pool. The second is the driver
 * underneath it: `drizzle(new Pool(...))` produces exactly the same unscoped
 * handle without going near `@/db/client`, so guarding only the module is
 * bolting the front door of a house with an open window. `pg` arrived with the
 * migration runner (#17), which is what made the second one reachable.
 *
 * The third arrived with #26 and is the subtlest, because what it produces is
 * not an unscoped handle but a *wrongly* scoped one. `forOrg(orgId)` takes an
 * org id and checks nothing about it — the membership check is `getOrgContext()`'s
 * — so `forOrg(params.orgId)` reads another tenant's rows while looking entirely
 * ordinary. ADR-0003 calls that the failure that is invisible in review because
 * correct and incorrect code look identical, and a doc comment saying "do not
 * call this" is not a guard against a failure described that way. The export
 * exists for `getOrgContext()`, which is in the same file and needs no import,
 * and for the one test that has to build a handle without a session.
 *
 * The files allowed past:
 *
 *   src/server/org-context.ts  the scoping helper itself (#26)
 *   src/db/client.ts           the pool it wraps (#25 needed it first)
 *   src/server/auth.ts         the auth provider (#25)
 *   src/db/migrate.mts         the migration runner, which predates any org
 *                              context and opens its own connection
 *   src/db/backup.mts          the nightly backup (#35), which reads every
 *                              org at once, as a role that can write none
 *   src/server/demo.ts         the demo org's nightly reset (#34), which
 *                              deletes and recreates one org — the demo — on
 *                              the identity path and writes its content as the
 *                              scoped role (ADR-0011)
 *   src/test/db.ts             the integration harness (#21)
 *   src/server/org-context.integration.test.ts
 *                              the only test that calls `forOrg()` directly,
 *                              because proving `SET LOCAL` is local means
 *                              driving the helper without a session (#26)
 *
 * `src/server/auth.ts` is the one that looks like a concession and is not. The
 * four tables Better Auth reads through the handle sit *above* the tenancy
 * boundary by construction — `docs/data-model.md` §2 — and are read during
 * sign-in, before any org exists to scope by, so there is no filter to omit. It
 * also touches `organizations`, `memberships` and `invitations`, and what keeps
 * that honest is that it reaches them only through the organization plugin's own
 * endpoints, which scope by the signed-in user's membership. #27's cross-org
 * isolation test is where that stops being a claim.
 *
 * The harness is on the list for a reason that is the opposite of a concession.
 * #27's cross-org isolation test has to prove that a scoped handle hides another
 * org's rows, and a test that can only see through the scoped handle cannot tell
 * a row that was correctly hidden from one that was never written. Reading it
 * unscoped is the assertion. Nothing in `src/` imports this file; it is loaded
 * by Vitest and by nothing else.
 *
 * One `ignores` list covers all of them rather than a block per file, because
 * `no-restricted-syntax` and `no-restricted-imports` are both replaced and not
 * merged when two config blocks set them — a second block would silently disarm
 * the dynamic-import guard below for every file it matched. The cost is that the
 * list is a little looser than ideal: the runner is permitted to import
 * `@/db/client`, `org-context.ts` to import `pg` directly, and the integration
 * test to do either. None of them should, all of them are named right here, and
 * they are the files in this repository that get read most carefully.
 */
const UNSCOPED_DB_ALLOWED = [
  "src/server/org-context.ts",
  "src/server/org-context.integration.test.ts",
  "src/db/client.ts",
  "src/server/auth.ts",
  "src/db/migrate.mts",
  "src/db/backup.mts",
  "src/server/demo.ts",
  "src/test/db.ts",
];

const RAW_DB_MESSAGE =
  "Never import the raw database client — it is not org-scoped. " +
  "Use `const { db } = await getOrgContext()` from '@/server/org-context', " +
  "which resolves the org from the session and returns a scoped handle. " +
  "See ADR-0003.";

const DRIVER_MESSAGE =
  "Never construct a database connection outside src/db — a handle built here " +
  "is not org-scoped, which is the failure the ESLint rule on '@/db/client' " +
  "exists to prevent. Use `const { db } = await getOrgContext()` from " +
  "'@/server/org-context'. See ADR-0003.";

const FOR_ORG_MESSAGE =
  "Never import `forOrg` or `enterOrg` — they scope to whatever org id you hand them and check " +
  "none of them, so an id that came from a request reads another tenant's " +
  "rows. Use `const { db } = await getOrgContext()` from " +
  "'@/server/org-context', which resolves the org from the session and joins " +
  "`memberships` to decide. See ADR-0003.";

const UNSCOPED_DB_IMPORTS = [
  {
    group: ["@/db/client", "@/db/client.*", "**/db/client"],
    message: RAW_DB_MESSAGE,
  },
  {
    group: [
      "pg",
      "pg/*",
      "drizzle-orm/node-postgres",
      "drizzle-orm/node-postgres/*",
    ],
    message: DRIVER_MESSAGE,
  },
  {
    // `importNames` rather than a `group`, because the module is the one every
    // server component is meant to import — it is the single export inside it
    // that must not travel.
    group: ["@/server/org-context", "**/server/org-context"],
    importNames: ["forOrg", "enterOrg"],
    message: FOR_ORG_MESSAGE,
  },
];

/**
 * `no-restricted-imports` only inspects static import declarations — as of
 * ESLint 9.39 a dynamic `import("@/db/client")` walks straight past it. This
 * selector closes that door for both groups above. A non-literal specifier is
 * still out of reach, which is the limit of what lint can see.
 */
const UNSCOPED_DB_DYNAMIC_IMPORT = String.raw`ImportExpression[source.value=/^(pg|drizzle-orm\/node-postgres)(\/|$)|(^|\/)db\/client(\.[a-z]+)?$/]`;

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    name: "capexwise/no-unscoped-db",
    // The carve-out is an `ignores` on this block rather than a later block
    // setting these rules to "off". An "off" block is a hole that the next
    // restricted-syntax rule added here would fall into unnoticed.
    ignores: UNSCOPED_DB_ALLOWED,
    rules: {
      "no-restricted-imports": ["error", { patterns: UNSCOPED_DB_IMPORTS }],
      "no-restricted-syntax": [
        "error",
        {
          selector: UNSCOPED_DB_DYNAMIC_IMPORT,
          message: RAW_DB_MESSAGE,
        },
      ],
    },
  },
  // Turns off the stylistic rules Prettier owns. Must stay last.
  prettier,

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
