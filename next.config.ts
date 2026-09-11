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

export default nextConfig;
