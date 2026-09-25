/**
 * Error tracking in the browser (ADR-0013). Next.js runs this module once, at
 * the top of the client bundle, which is why the file is at this exact path and
 * has this exact name — it is a framework convention, not a choice.
 *
 * `src/server/sentry.ts` is the server's half and carries the reasoning the two
 * share. What is different here is what a browser can be told and what it must
 * never be told:
 *
 * - **The DSN is its own variable.** `NEXT_PUBLIC_SENTRY_DSN`, not `SENTRY_DSN`,
 *   so that reporting from the browser and reporting from the server are two
 *   switches. It reaches the bundle through `src/lib/env-public.ts`, which is
 *   the module that exists to make "this value is allowed in a browser" a
 *   decision somebody made rather than a prefix somebody typed.
 * - **There is no `environment`.** Reading `VERCEL_ENV` here would mean
 *   publishing it, and the DSN is set in production alone — so every event this
 *   file sends is a production event by construction, and a tag saying so would
 *   add nothing it could get wrong.
 * - **There is no `release` either.** `withSentryConfig` injects the commit into
 *   the client bundle at build time, which is the one way the browser can know
 *   it without a second published variable.
 *
 * **No `replayIntegration`, and that absence is load-bearing.** Session replay
 * records the DOM, and the DOM here is tenant names, unit addresses and the
 * button that reveals an access code. ADR-0013 keeps it out of the dependency
 * rather than off by a setting, for the same reason it keeps PostHog out of the
 * browser entirely: a setting is something a person can turn on while debugging
 * a layout bug.
 */
import * as Sentry from "@sentry/nextjs";

import { publicEnv } from "@/lib/env-public";
import { scrubEvent } from "@/lib/sentry-scrub";

/**
 * The DSN, or nothing — and never a throw.
 *
 * `publicEnv()` validates, and on the server a validation failure is exactly
 * what should happen: the process refuses to start and names the variable, so
 * the operator fixes it before anybody sees the deploy. **Here the same
 * strictness would invert.** This module runs at the top of the client bundle,
 * so a throw is not a report of the problem, it is a blank page — and the
 * problem it would be reporting is a typo in an optional variable whose entire
 * job is to report problems.
 *
 * Reachable with `SENTRY_DSN` set correctly and `NEXT_PUBLIC_SENTRY_DSN` set to
 * something malformed: they are two variables holding one value, so exactly one
 * of them can be wrong, and the server's boot check would pass.
 *
 * So the browser degrades where the server refuses. The failure is not silent —
 * it goes to the console, which is where a developer looking for the missing
 * error reports will be.
 */
function dsnOrNothing(): string | undefined {
  try {
    return publicEnv().NEXT_PUBLIC_SENTRY_DSN;
  } catch (error) {
    // The message names the variable and never a value — `parseEnv` guarantees
    // that, and it is the reason this is safe to print in a browser at all.
    console.warn(
      `Error reporting is off: ${error instanceof Error ? error.message : error}`,
    );

    return undefined;
  }
}

const dsn = dsnOrNothing();

if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0,

    // The same hook as the server's, and it matters more here: a browser event
    // arrives with breadcrumbs describing what the person clicked, and on this
    // product the thing they clicked is named after a building.
    beforeSend: scrubEvent,
  });
}

/**
 * Next.js hands Sentry the start of every client-side navigation, so an error
 * after a route change is attributed to the route it happened on rather than to
 * the one the tab was opened at. Exported unconditionally: with no DSN,
 * `Sentry.init()` never ran and this is a no-op.
 */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
