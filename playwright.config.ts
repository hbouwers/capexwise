import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests. One browser, one smoke test, and deliberately no more: this
 * suite exists to catch the failures that only appear when a real browser loads
 * a real server — a route that 500s, a stylesheet that never arrives, a font
 * that does not load — and every assertion that does not need a browser belongs
 * in the Vitest suite, which is two orders of magnitude faster.
 *
 * The server is `next dev`, not a production build. That used to be forced —
 * every build but Vercel's was standalone, and `next start` refuses to serve
 * standalone output — and since #70 it is a choice: only the image is built
 * standalone now, so `npm run build && npm start` would work here. It stays
 * `next dev` because a build first costs the better part of a minute on every
 * run, locally and on the CI job that is already the pipeline's long pole, to
 * re-prove what the container workflow proves on every pull request: that the
 * production artefact boots and serves its stylesheet. So: the container
 * workflow proves the artefact, and this proves the pages render.
 *
 * The dev server runs `src/instrumentation.ts` like any other, so it needs every
 * variable in `src/lib/env-schema.mts` to be present and well-formed before it
 * will start — locally from `.env.local`, in CI from the workflow. It does not
 * need any of them to *work*: nothing here reaches the database or Google, so
 * the Google client in CI is a pair of obviously-fake strings and that is the
 * honest thing for it to be.
 */

// Not 3000 and not 3001. `npm run dev` holds the first and `npm run docker:up`
// the second, and a suite that quietly attaches to a server someone left running
// is a suite that passes against last week's code.
const PORT = 3100;

// `localhost`, not the `127.0.0.1` used everywhere else in this repository. Next
// treats a dev request whose Host is not the origin it believes it is serving as
// cross-origin and blocks `/_next/hmr`, so the literal address produces a wall of
// `allowedDevOrigins` warnings on every run. Nothing here needs HMR, but a
// warning that is always printed is one nobody reads when it matters.
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",

  // `test.only` left in a commit passes locally and silently skips its
  // neighbours in CI. This makes it a failure there instead.
  forbidOnly: Boolean(process.env.CI),

  // Retries in CI only. Locally a flake should be seen, not smoothed over; in
  // CI it should not turn an unrelated pull request red.
  retries: process.env.CI ? 2 : 0,

  // One worker in CI: the shared runner is single-digit cores and already busy
  // running the dev server, and parallel browsers there produce timeouts that
  // look like application faults.
  workers: process.env.CI ? 1 : undefined,

  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],

  use: {
    baseURL: BASE_URL,
    // Only for a test that already failed once. A trace on every run is slow and
    // large; a trace on the retry is the one anybody opens.
    trace: "on-first-retry",
  },

  // Chromium alone. The prototype is desktop-only and the responsive behaviour
  // is not specified yet (#12), so a second engine here would multiply the cost
  // of a suite that cannot yet assert the thing the other engines would differ
  // on. Widen it when there are screens to widen it for.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    // Locally, reuse a server already on the port — the second run of a test
    // then starts in a second rather than in thirty. In CI there is never one to
    // reuse and finding one would mean something is wrong.
    reuseExistingServer: !process.env.CI,
    // A cold `next dev` compiles the route on first request, and on a cold CI
    // runner that is slow enough that the default would time out on a machine
    // rather than on a fault.
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
