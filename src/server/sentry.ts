/**
 * Error tracking on the server (ADR-0013). `src/instrumentation.ts` calls this
 * once, at boot; `src/instrumentation-client.ts` is the browser's half.
 *
 * ## Off unless a DSN says otherwise
 *
 * No `SENTRY_DSN`, no reporting, and that is the state on every laptop and
 * every preview branch. A preview reporting into the same project as production
 * makes the production feed useless within a week — half-finished branches
 * arrive in the same stream as the errors real people actually hit — so the
 * variable is set in Vercel's Production scope and nowhere else.
 *
 * ## Why this runs after the environment check and not before
 *
 * `verifyEnvironment()` in `src/server/boot.ts` is what makes a bad
 * configuration a startup failure naming the variable (#20). It works by
 * calling `env()` inside a `try`, because `env()` parses on first use. Anything
 * that calls `env()` earlier moves the first parse outside that `try`, and the
 * careful message becomes a stack trace out of the instrumentation loader.
 *
 * So the order in `register()` is: check the environment, then start Sentry.
 * The cost is that a configuration failure is not reported to Sentry — which is
 * the right trade anyway. A process that exits at boot because a variable is
 * missing has no session in which to flush an event, and the failure is already
 * on the first screen of the deploy log.
 */
import "server-only";

import * as Sentry from "@sentry/nextjs";

import { scrubEvent } from "@/lib/sentry-scrub";
import { env } from "@/server/env";

export function initSentry(): void {
  const { SENTRY_DSN, VERCEL_ENV, VERCEL_GIT_COMMIT_SHA } = env();

  if (!SENTRY_DSN) return;

  Sentry.init({
    dsn: SENTRY_DSN,

    // `development` where Vercel sets nothing — a container, a laptop that has
    // deliberately set a DSN. Naming it is better than letting every such event
    // arrive untagged and indistinguishable from production's.
    environment: VERCEL_ENV ?? "development",

    // The commit, so a regression names the deploy that introduced it. Absent
    // off Vercel, and absent is reported as absent: Sentry groups unreleased
    // events on their own rather than attributing them to the last known
    // release, which is the honest answer.
    release: VERCEL_GIT_COMMIT_SHA,

    // Sentry's own switch for attaching the user, the IP and the cookies. Off,
    // and `beforeSend` removes them again on the way out — CLAUDE.md's rule is
    // absolute enough to be worth defending twice, and the second defence is
    // the one that still holds after somebody changes this line.
    sendDefaultPii: false,

    // No performance tracing. #36 asks for error tracking, and tracing is a
    // separate decision with its own cost: spans carry URLs and parameters
    // through a different code path from the one `beforeSend` guards, and the
    // sampling has to be tuned against a request volume that does not exist
    // yet. Zero is a decision to revisit with real traffic, not an oversight.
    tracesSampleRate: 0,

    // The whole of the PII defence for this transport. `src/lib/sentry-scrub.ts`
    // says what it removes and why, and the unit suite holds it.
    beforeSend: scrubEvent,
  });
}
