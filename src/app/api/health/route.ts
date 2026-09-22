/**
 * What an uptime checker hits (#36, ADR-0013). `docs/runbooks/observability.md` has
 * the setup; this is the whole of the application's side of it.
 *
 * Public and unauthenticated, deliberately: a check that had to hold a
 * credential would be a credential in a third-party monitoring service, renewed
 * by nobody, to protect two fields that say nothing. What it returns is the
 * commit and the word `ok`, and neither is worth hiding — the repository is
 * public from v0.5, so the commit is already readable by anyone who cares.
 *
 * ## It does not touch the database, and that is the decision
 *
 * ADR-0013 has the argument in full. In short: querying Postgres from here
 * would mean importing the raw client, which means adding a ninth file to the
 * allowlist in `eslint.config.mjs` — the list that is the whole of ADR-0003's
 * second guard — in exchange for a signal error tracking already provides
 * within seconds and with the SQLSTATE attached. If the database is gone, every
 * real request fails and Sentry says so. Trading the strongest structural guard
 * in the codebase for a faster version of an existing signal is a bad trade, and
 * it is the kind nobody revisits once it is made.
 *
 * So this answers one question — is a server process running and serving — and
 * it answers it honestly rather than answering a broader one badly.
 */
import { env } from "@/server/env";

/**
 * Never prerendered, and this is the line that makes the route worth having.
 *
 * Everything this handler returns is known at build time, so Next.js would be
 * entitled to turn it into a static file — and a static file is served by the
 * CDN whether or not any server is alive. The check would then pass through an
 * outage, which is worse than no check, because it is a check somebody trusts.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(
    {
      status: "ok",
      // `unknown` where nothing set it — off Vercel, in the container, on a
      // laptop. A true "I don't know" rather than a plausible-looking value.
      release: env().VERCEL_GIT_COMMIT_SHA ?? "unknown",
    },
    {
      // Belt to `force-dynamic`'s braces: `force-dynamic` governs Next's own
      // cache, and this governs every proxy and CDN between here and the
      // checker. Both have to say no, or the answer is somebody's copy.
      headers: { "cache-control": "no-store" },
    },
  );
}
