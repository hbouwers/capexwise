import type { NextConfig } from "next";

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
  // Vercel ignores this setting — it builds its own output — so it costs nothing
  // there. It does mean `.next/standalone` has to stay in step with what the
  // server needs: a dependency loaded by a path Next cannot trace statically is
  // missing at runtime and present in `npm start`, which is why CI starts the
  // container rather than only building it.
  output: "standalone",
};

export default nextConfig;
