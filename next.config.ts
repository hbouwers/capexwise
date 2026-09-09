import type { NextConfig } from "next";

/**
 * Vercel builds its own output and runs its own post-build step over `.next`.
 * `output: "standalone"` changes what that step finds, and on Next 16.3.4 the
 * combination fails: the build itself succeeds — compile, typecheck and static
 * generation all pass — and then Vercel's `onBuildComplete` throws
 * `ENOENT ... .next/next-server.js.nft.json` and the deployment errors.
 *
 * This is not reproducible with `next build` alone. Locally the file is written
 * in both modes; the breakage lives in Vercel's builder layer, which is the
 * layer that cannot be exercised from here. So the setting is scoped to the
 * builds that actually want it rather than left on and reasoned about.
 *
 * `VERCEL` is set in every Vercel build environment. The container build does
 * not set it — the Dockerfile runs `npm run build` inside the image — so the
 * image still gets `.next/standalone`, which is the whole reason the setting
 * exists.
 */
const isVercelBuild = Boolean(process.env.VERCEL);

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
  // Off on Vercel, for the reason above the file.
  output: isVercelBuild ? undefined : "standalone",
};

export default nextConfig;
