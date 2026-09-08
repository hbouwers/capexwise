import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

/**
 * The raw database client is unscoped. Reaching it directly is how a query
 * ships without an `org_id` filter, which is the one failure this codebase
 * cannot recover from — see ADR-0003.
 *
 * Two files are allowed to import it, and nothing else ever is:
 *
 *   src/server/org-context.ts  the scoping helper itself (#26)
 *   src/db/migrate.ts          the migration runner, which predates any org (#17)
 *
 * Neither exists yet. When #17 lands, if the runner takes a different path,
 * change it here rather than adding a third exemption.
 */
const RAW_DB_CLIENT = ["@/db/client", "@/db/client.*", "**/db/client"];

const RAW_DB_MESSAGE =
  "Never import the raw database client — it is not org-scoped. " +
  "Use `const { db } = await getOrgContext()` from '@/server/org-context', " +
  "which resolves the org from the session and returns a scoped handle. " +
  "See ADR-0003.";

const RAW_DB_ALLOWED = ["src/server/org-context.ts", "src/db/migrate.ts"];

/**
 * `no-restricted-imports` only inspects static import declarations — as of
 * ESLint 9.39 a dynamic `import("@/db/client")` walks straight past it. This
 * selector closes that door. A non-literal specifier is still out of reach,
 * which is the limit of what lint can see.
 */
const RAW_DB_DYNAMIC_IMPORT = String.raw`ImportExpression[source.value=/(^|\/)db\/client(\.[a-z]+)?$/]`;

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    name: "capexwise/no-raw-db-client",
    // The carve-out is an `ignores` on this block rather than a later block
    // setting these rules to "off". An "off" block is a hole that the next
    // restricted-syntax rule added here would fall into unnoticed.
    ignores: RAW_DB_ALLOWED,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: RAW_DB_CLIENT,
              message: RAW_DB_MESSAGE,
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: RAW_DB_DYNAMIC_IMPORT, message: RAW_DB_MESSAGE },
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
