/**
 * What is stripped from an error before it leaves the process for Sentry.
 * ADR-0013 is the decision; this is the part of it that is worth testing.
 *
 * Sentry's defaults are careful about *identity* — `sendDefaultPii: false`
 * means it attaches no user, no IP and no cookies of its own — and they are not
 * careful about *payloads*, because no general-purpose tool can be. A failed
 * server action reports its arguments, and on this product the argument to a
 * contact save is a contact: a name, a phone number and an email. A failed
 * building save carries an address.
 *
 * This is the same class of leak `src/lib/query-errors.ts` already prevents one
 * layer down, arriving by a second route. That one strips Drizzle's bound
 * parameters out of a message; this one strips the request off the event that
 * carries the message. Neither subsumes the other — a server action can fail
 * without touching the database, and a query can fail somewhere nothing catches
 * it — which is why both exist.
 *
 * **Deny by removal, not by pattern.** Nothing here tries to recognise PII. It
 * removes the four places a request body can hide and keeps the one field that
 * is useful and safe, which is the route. That is the opposite trade from
 * `src/lib/log.ts`'s scrubber, and deliberately: there, the fields are chosen by
 * hand at the call site and the patterns are a backstop; here, the fields are
 * chosen by a third-party SDK and nothing can be assumed about them.
 *
 * Framework-free and structurally typed, so the unit suite can hold it without
 * constructing a Sentry event and without the assertions rotting the next time
 * the SDK's types move.
 */

/** The parts of a Sentry event this touches. Structural, so the SDK's own type satisfies it. */
export type ScrubbableEvent = {
  request?: {
    url?: string;
    method?: string;
    headers?: unknown;
    cookies?: unknown;
    data?: unknown;
    query_string?: unknown;
  };
  user?: unknown;
  breadcrumbs?: { category?: string }[];
};

/**
 * Breadcrumbs that record what was clicked or typed.
 *
 * `ui.click` carries the element, and on this product the elements are named
 * after buildings, units and contacts — "Reveal code for 1442 Woodlawn Ave" is
 * a breadcrumb and an address. `ui.input` is worse and records that a field was
 * typed in at all. Both go; the ones that survive are `navigation`, `fetch`,
 * `xhr` and `console`, which are the ones that say what the application was
 * doing rather than what the person was looking at.
 */
const DROPPED_BREADCRUMBS = new Set(["ui.click", "ui.input"]);

/**
 * The URL with its query string removed.
 *
 * A query string is a request field like any other and gets the same treatment
 * — PRD §11 and CLAUDE.md both say personal data never rides in one, but this
 * is the layer that stops a mistake there from becoming a copy held by a
 * vendor. The path survives, which is the part that says which route broke.
 *
 * Deliberately string surgery rather than `new URL()`: a malformed or relative
 * URL makes that constructor throw, and a `beforeSend` that throws loses the
 * error it was called about.
 */
function withoutQuery(url: string): string {
  const cut = url.search(/[?#]/);

  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * Removes everything from `event` that could carry somebody's data, and returns
 * it. Mutates rather than copies, because that is what a `beforeSend` hook owns
 * and a copy would have to know every field the SDK might add later.
 */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  // Set by nothing here, and removed anyway: `sendDefaultPii: false` is a
  // setting, and a setting is a thing that can be changed by somebody who does
  // not know what it guards.
  delete event.user;

  if (event.request) {
    delete event.request.headers;
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.query_string;

    if (event.request.url) {
      event.request.url = withoutQuery(event.request.url);
    }
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.filter(
      (crumb) => !DROPPED_BREADCRUMBS.has(crumb.category ?? ""),
    );
  }

  return event;
}
