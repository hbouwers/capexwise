import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

/**
 * An unscoped database handle is how a query ships without an `org_id` filter,
 * which is the one failure this codebase cannot recover from — see ADR-0003.
 *
 * There are two ways to get one and both are closed here. The first is
 * `@/db/client`, the module that will hold the pool (#26). The second is the
 * driver underneath it: `drizzle(new Pool(...))` produces exactly the same
 * unscoped handle without going near `@/db/client`, so guarding only the module
 * is bolting the front door of a house with an open window. `pg` arrived with
 * the migration runner (#17), which is what made the second one reachable.
 *
 * The files allowed past:
 *
 *   src/server/org-context.ts  the scoping helper itself (#26)
 *   src/db/client.ts           the pool it wraps (#25 needed it first)
 *   src/server/auth.ts         the auth provider (#25)
 *   src/db/migrate.mts         the migration runner, which predates any org
 *                              context and opens its own connection
 *   src/test/db.ts             the integration harness (#21)
 *
 * All five exist as of #26.
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
 * One `ignores` list covers all four rather than a block per file, because
 * `no-restricted-syntax` is replaced and not merged when two config blocks both
 * set it — a second block would silently disarm the dynamic-import guard below
 * for every file it matched. The cost is that the list is a little looser than
 * ideal: the runner is permitted to import `@/db/client` and `org-context.ts`
 * to import `pg` directly, though neither should. Both are named right here,
 * and they are the two files in this repository that get read most carefully.
 */
const UNSCOPED_DB_ALLOWED = [
  "src/server/org-context.ts",
  "src/db/client.ts",
  "src/server/auth.ts",
  "src/db/migrate.mts",
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
