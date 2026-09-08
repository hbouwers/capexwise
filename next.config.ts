import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` otherwise appends a managed block to CLAUDE.md on every run.
  // CLAUDE.md is hand-written and is the project's own contract; a framework
  // rewriting it in the background is a surprise, not a feature.
  agentRules: false,
};

export default nextConfig;
