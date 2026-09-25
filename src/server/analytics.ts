/**
 * The onboarding funnel (#36, ADR-0013). Four events, emitted from the server,
 * to answer one question: where do people stop before the forecast?
 *
 * PRD §11 calls manual entry the most likely reason a trial user churns, and
 * #39 owns fixing it. This is the measurement that has to exist *before* the
 * fix, because a funnel instrumented alongside its own remedy cannot say
 * whether the remedy worked.
 *
 * ## Nothing here runs in a browser
 *
 * `posthog-node`, called from server actions and Server Components that already
 * run. No `posthog-js`, no autocapture, no session replay, no cookie, and so no
 * consent banner. ADR-0013 has the argument; the short version is that
 * autocapture records the text of what people click, and on this product the
 * things people click are named after buildings, units and contacts. It cannot
 * be configured safe, only left out.
 *
 * ## What PostHog is told
 *
 * The user id and the org id — both UUIDv7 (ADR-0005), both naming nobody — an
 * event name, and a timestamp. No email, no name, no address, ever. That is not
 * a policy applied at the call sites; it is the whole of what `track()` below
 * is able to send.
 *
 * ## The demo org is excluded, and not by remembering to
 *
 * `Actor.isDemo` is a required field, and a demo actor returns early. A public
 * demo that anybody can click through would otherwise be most of the funnel
 * within a week — hundreds of visitors creating a building, none of them a
 * person deciding whether to pay — and a funnel measuring that measures
 * nothing. Making it a required field rather than an optional flag is what
 * stops a new call site from quietly opting in.
 *
 * ## It never breaks a request
 *
 * Every path here is wrapped and swallowed. An analytics vendor being slow,
 * misconfigured or down is not a reason a landlord cannot save a building, and
 * the failure is logged so it is visible without being fatal.
 */
import "server-only";

import { after } from "next/server";
import { PostHog } from "posthog-node";

import { logEvent } from "@/lib/log";
import { env } from "@/server/env";

/**
 * The funnel, decided in ADR-0013 and spelled here so that adding a fifth is a
 * change to this line rather than a string typed at a call site. A typo in a
 * free-form event name does not fail, it just never appears in the funnel —
 * which looks exactly like a step people stopped reaching.
 */
export type FunnelEvent =
  "signed_up" | "building_created" | "capital_item_added" | "forecast_viewed";

/**
 * Who did it. Both ids, and whether this is the demo — see the note above for
 * why that last one is required rather than optional.
 */
export type Actor = {
  userId: string;
  orgId: string;
  isDemo: boolean;
};

/**
 * `undefined` before the first call, `null` once it is known there is no key.
 * The three states matter: `null` is a decision already made, and re-reading
 * the environment on every event to reach it again would be work on the write
 * path for no answer.
 */
let client: PostHog | null | undefined;

/**
 * PostHog's US cloud, which is what a key from the default signup expects. The
 * fallback lives here rather than in the schema for the reason
 * `src/lib/env-schema.mts` gives: a `.default()` there would put this key in
 * every parsed environment, including the ones with no analytics at all.
 */
const DEFAULT_HOST = "https://us.i.posthog.com";

function posthog(): PostHog | null {
  if (client !== undefined) return client;

  const { POSTHOG_KEY, POSTHOG_HOST } = env();

  client = POSTHOG_KEY
    ? new PostHog(POSTHOG_KEY, {
        host: POSTHOG_HOST ?? DEFAULT_HOST,

        // Send each event as it happens rather than batching. Batching is the
        // right default for a long-lived process and the wrong one here: a
        // serverless function is frozen the moment it responds, and a batch
        // still in memory is a batch that never arrives.
        flushAt: 1,
        flushInterval: 0,
      })
    : null;

  return client;
}

/**
 * Records that `event` happened. Returns immediately; the send is finished
 * after the response, which is what `after()` is for.
 *
 * Without `after()` this would be a choice between awaiting a third party on
 * the request path and dropping the event when the function freezes. With it,
 * neither: the response goes out, and the flush runs in the window Next.js
 * keeps open for exactly this.
 */
export function track(
  event: FunnelEvent,
  actor: Actor,
  properties: Record<string, string | number | boolean> = {},
): void {
  // The demo is not the funnel. See the note above the file.
  if (actor.isDemo) return;

  // Written whether or not PostHog is configured, so the funnel is legible from
  // the logs alone — on a laptop, in CI, and on any deploy where the key is
  // unset. It is also the record that survives if the vendor decision is ever
  // reversed, which ADR-0013 names as the expensive part of reversing it.
  logEvent({
    log: "funnel",
    orgId: actor.orgId,
    fields: { event, user_id: actor.userId, ...properties },
  });

  const posthogClient = posthog();

  if (!posthogClient) return;

  try {
    posthogClient.capture({
      distinctId: actor.userId,
      event,
      properties: { ...properties, org_id: actor.orgId },
    });

    after(async () => {
      try {
        await posthogClient.flush();
      } catch (error) {
        report("flush", actor.orgId, error);
      }
    });
  } catch (error) {
    // Reached when `after()` is called outside a request scope, or when the
    // client rejects the event outright. Neither is worth a 500.
    report("capture", actor.orgId, error);
  }
}

/**
 * Says that analytics failed, and says nothing about what was being tracked.
 * The message is the SDK's own — a network or configuration complaint — and
 * `logEvent` scrubs it on the way out, which is the backstop rather than the
 * reason it is safe.
 */
function report(
  stage: "capture" | "flush",
  orgId: string,
  error: unknown,
): void {
  logEvent({
    log: "analytics_failed",
    orgId,
    level: "warn",
    fields: {
      stage,
      reason: error instanceof Error ? error.message : "unknown",
    },
  });
}
