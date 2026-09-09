import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

/**
 * Two projects, because the two suites have different costs and different
 * prerequisites, and collapsing them would make the cheap one pay for the
 * expensive one.
 *
 * `unit` needs nothing — no database, no server, no network — so it runs on
 * every save and in the pre-commit hook's budget. `integration` needs Postgres
 * and truncates between tests, so it is opt-in locally (`npm run db:up` first)
 * and a separate step in CI where the service is guaranteed.
 *
 * Playwright is not here. It is a different runner with its own config; see
 * `playwright.config.ts`.
 *
 * `.mts` rather than `.ts` for the same reason `src/db/migrate.mts` is:
 * `package.json` has no `"type"` field, so a `.ts` config is loaded as CommonJS
 * first and warns on every run. Adding `"type": "module"` to silence it would
 * change module resolution for the whole project.
 */
const src = fileURLToPath(new URL("./src", import.meta.url));

/**
 * `next build` resolves `@/*` through `tsconfig.json`; Vitest does not read it.
 * Rather than add a plugin to bridge the two, the one alias the codebase uses is
 * repeated here. A second alias appearing in `tsconfig.json` and not here is a
 * test-only module-not-found, which is why there is only ever meant to be one.
 */
/**
 * `server-only` is a marker package: imported through the `react-server`
 * condition it is an empty module, and through any other condition it throws
 * "This module cannot be imported from a Client Component module". Next.js sets
 * that condition on the server graph; Vitest sets no conditions at all, so every
 * module that guards itself with it — `@/server/env`, `@/db/client`,
 * `@/server/auth` — would be untestable.
 *
 * Aliased to the package's own `empty.js` rather than to a stub of ours, and
 * rather than adding `react-server` to `resolve.conditions`: it is the exact
 * module Next would resolve, and it does not change how anything *else*
 * resolves. React ships a `react-server` build too, and switching the whole
 * suite onto it to fix an import guard would be a much larger change than the
 * problem.
 *
 * The guard itself still works where it matters. It is a build-time boundary,
 * and `next build` is what enforces it — CI runs that as its own job.
 */
const alias = {
  "@": src,
  "server-only": fileURLToPath(
    new URL("./node_modules/server-only/empty.js", import.meta.url),
  ),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.{ts,mts,tsx}"],
          // `*.integration.test.ts` also matches the include above, and picking
          // it up here would run the database suite in the project that has no
          // database. Spread the defaults rather than replacing them —
          // assigning a bare array drops the `node_modules` and `dist` entries
          // Vitest ships with.
          exclude: [...configDefaults.exclude, "**/*.integration.test.*"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["src/**/*.integration.test.{ts,mts}"],
          // Creates the test database and migrates it, once for the run.
          globalSetup: ["./src/test/global-setup.ts"],
          // Opens a connection and truncates before each test, per file.
          setupFiles: ["./src/test/setup-integration.ts"],
          // One database, shared. Files running in parallel would truncate each
          // other's rows mid-test, and the failure would be intermittent and
          // read like a bug in whichever test lost the race. Vitest still runs
          // this project in parallel with `unit`, which touches nothing.
          fileParallelism: false,
        },
      },
    ],
  },
});
