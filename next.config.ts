// `@sentry/nextjs/config`, not `@sentry/nextjs`: the root export of the build
// plugin is deprecated and stops working in the SDK's v11.
import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

/**
 * `output: "standalone"` is for the container image and nothing else, so the
 * image asks for it — the Dockerfile's builder stage sets `BUILD_STANDALONE=1`
 * — and every other build is a plain one. It used to be the other way round,
 * on unless Vercel was building, and both of the builds that were not the
 * image had a reason to object:
 *
 * - **Vercel** builds its own output and runs its own post-build step over
 *   `.next`. On Next 16.3.4, standalone makes that step throw `ENOENT ...
 *   .next/next-server.js.nft.json` after an otherwise clean build (#67). It is
 *   not reproducible with `next build` alone; the breakage lives in Vercel's
 *   builder layer, which cannot be exercised from here.
 * - **`next start`** refuses to serve standalone output — it warns and says to
 *   run `.next/standalone/server.js` instead — so `npm start` after a local
 *   build was relying on behaviour Next documents as unsupported (#70).
 *
 * Exactly `"1"`, not any value. A typo in the Dockerfile then builds without
 * standalone, and the runner stage fails loudly on a `.next/standalone` that
 * is not there, rather than a stray `BUILD_STANDALONE=0` somewhere turning it
 * on.
 */
const isStandaloneBuild = process.env.BUILD_STANDALONE === "1";

const nextConfig: NextConfig = {
  // `next dev` otherwise appends a managed block to CLAUDE.md on every run.
  // CLAUDE.md is hand-written and is the project's own contract; a framework
  // rewriting it in the background is a surprise, not a feature.
  agentRules: false,

  // Traces the modules the server actually reaches and writes a self-contained
  // `.next/standalone` with only those, so the container image ships a server and
  // its real dependencies rather than the whole of `node_modules`. This is what
  // the Dockerfile copies, and ADR-0002 is why the Dockerfile exists at all.
  //
  // It does mean `.next/standalone` has to stay in step with what the server
  // needs: a dependency loaded by a path Next cannot trace statically is missing
  // at runtime and present in `npm start`, which is why CI starts the container
  // rather than only building it.
  //
  // Only when the image asks, for the reasons above the file.
  output: isStandaloneBuild ? "standalone" : undefined,
};

/**
 * Sentry's build plugin (ADR-0013). It does three things to the build: injects
 * the commit as the release so the browser knows it without a second published
 * variable, wraps the server entry points so `onRequestError` is reachable, and
 * uploads source maps — so that a minified stack trace is readable.
 *
 * **`process.env` here is correct, and is the same exception `drizzle.config.ts`
 * takes.** CLAUDE.md's rule is that configuration comes from `@/server/env`, and
 * that module is `server-only` and parses the *server's* environment at boot.
 * This file is a build-time config read by the Next.js CLI before any of that
 * exists, and none of these three values is read by the running application.
 * They are credentials for a build step, which is why they are also absent from
 * `serverEnvSchema` — the same reasoning that keeps `BACKUP_SOURCE_URL` out of
 * it.
 *
 * **Inert without credentials, which is the state everywhere but production.**
 * No `SENTRY_AUTH_TOKEN` means no upload and a build that still succeeds. That
 * is not a convenience: the Dockerfile builds with a genuinely empty
 * environment on purpose (ADR-0006), and CI builds the image on every pull
 * request, so a plugin that needed credentials to finish would have broken both.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Quiet unless something is wrong, except in CI where the log is the only
  // way to see what the plugin did.
  silent: !process.env.CI,

  // Source maps are uploaded to Sentry and then deleted from the output, so a
  // readable stack trace does not also mean publishing the application's source
  // to every browser that asks for it. The repository goes public at v0.5, so
  // the source is not a secret — but the two should be separate decisions, and
  // shipping maps by accident is not a decision.
  sourcemaps: { deleteSourcemapsAfterUpload: true },

  // The plugin phones home about build timings by default. Off, in a codebase
  // whose whole observability decision is about what leaves the process.
  telemetry: false,
});
