# ADR-0013: Observability — errors to Sentry, logs as JSON, a funnel measured on the server

**Status:** Accepted
**Date:** 2026-09-22
**Decided by:** Holden

## Context

v0.5 puts the demo on a public URL and makes the repository public. Until now every failure has
happened on a laptop with a terminal open, where a stack trace is one scroll away. After v0.5 the
first person to hit a crash is a stranger who will close the tab, and nothing in the system would
know it happened.

Four forces decide this one.

**There is no signal today.** The application writes to `console` in eight places and nothing
collects it. Vercel keeps runtime logs for a day on Hobby, searchable only by hand, and a Cloud Run
move (ADR-0002) changes where they land. A crash on the demo is currently invisible unless somebody
reports it, and nobody reports a demo.

**Onboarding drop-off is the PRD's stated top churn risk.** §11 says manual entry is "the most
likely reason a trial user churns" and that onboarding speed is a first-class design problem rather
than a polish item; #39 is the issue that owns fixing it. Fixing it means knowing where people stop,
and that is a measurement that has to exist *before* the fix, not after — a funnel instrumented
alongside the remedy cannot say whether the remedy worked.

**The data is other people's.** PRD §11 calls this a data-processing relationship the moment another
landlord's rows are in the system. CLAUDE.md's rule is absolute: never log an access code, never log
PII. An observability vendor is a third party that receives whatever the application sends it, so
every one of these tools is a new way to violate that rule by default rather than by mistake —
Sentry attaches request data, and product analytics SDKs autocapture DOM text, which on this product
means tenant names and street addresses.

**Whatever is chosen has to survive the Cloud Run move.** ADR-0002 keeps that an afternoon, and
ADR-0009 keeps one production at every stage. A tool that only works on Vercel would quietly make
the escape hatch more expensive, which is the one thing the Dockerfile exists to prevent.

## Decision

Four parts, one theme: the server is the only thing that reports, and it reports ids rather than
values.

### Errors — Sentry, with request data off

`@sentry/nextjs`, initialised for the Node server, the browser and the Edge runtime that does not
exist yet. The release is the commit sha, so a regression names the deploy that introduced it.

`sendDefaultPii: false`, and a `beforeSend` that strips cookies, headers, query strings and request
bodies before anything leaves the process. Sentry's defaults are safe about *identity* — it does not
attach a user without being asked — and unsafe about *payloads*: a failed server action reports its
arguments, and the argument to `saveContact` is a contact. The stripping is not a precaution against
a hypothetical, it is the same failure `src/lib/query-errors.ts` already exists to prevent one layer
down, arriving by a second route.

Sentry is off wherever `SENTRY_DSN` is unset, which is every laptop and every preview. That is
deliberate: a preview branch reporting into the same project as production makes the production
error feed useless within a week.

### Logs — one JSON line per event, and `org_id` is required

`src/lib/log.ts`. One function, one line of JSON per event, to stdout. Every platform in play —
Vercel, Cloud Run, `docker compose` — collects stdout and parses JSON, so this is the format that
needs no agent and no vendor, and it is the format that stays put across the move.

Two properties are enforced rather than documented:

1. **`orgId` is a required field, typed `string | null`.** Not optional. An event that genuinely has
   no org — a sign-in, a boot failure — passes `null` and says so. The difference between "no org"
   and "somebody forgot" is the difference between a log you can filter and a log you cannot, and an
   optional field collapses the two.
2. **Values are scrubbed on the way out.** Anything that looks like an email address or a run of
   seven or more digits is replaced with `[redacted]`, in the log line itself. This is the enforcement
   of CLAUDE.md's rule at the point where it would otherwise be a comment.

The scrubber redacts rather than throws. A logger that can take a request down is worse than the
leak it prevents, and a visible `[redacted]` in a log line is discoverable by the person reading the
log — which a silent drop is not.

This replaces the hand-rolled `JSON.stringify` in `recordAccessCodeEvent`, which was the first
instance of this pattern and said at the time that it was waiting for `audit_log` (#42). It still is.
This gives it an envelope, not a home.

### Uptime — `/api/health`, and it does not touch the database

A route that returns `200` with the release and nothing else. An external checker hits it every few
minutes; `docs/runbooks/observability.md` has the setup.

**It deliberately does not check the database.** A health route that queries Postgres would have to
import the raw client, which means adding a ninth file to `eslint.config.mjs`'s allowlist — the list
that is the whole of ADR-0003's second guard — in exchange for a signal error tracking already
provides. If the database is gone, every request fails and Sentry says so within seconds, with the
SQLSTATE. Trading the strongest structural guard in the codebase for a faster version of a signal
that already exists is a bad trade, and it is the kind that is never revisited once made.

### Product analytics — PostHog, server-side only, no browser script

`posthog-node`, called from the server actions and Server Components that already run. **Nothing is
added to the browser bundle.** No `posthog-js`, no autocapture, no session replay, no cookie, and
therefore no consent banner.

This is not the way PostHog is usually installed, and it is the decision's whole substance:

- **Autocapture on this product captures tenant names and street addresses.** It records the text of
  the elements people click, and the elements people click here are named after buildings, units and
  contacts. It cannot be made safe by configuration, only by being absent.
- **Session replay is one flag away from being the largest PII exposure in the system.** Not
  shipping the browser SDK is what puts it out of reach, rather than a setting somebody could flip
  while debugging a layout bug.
- **Ad blockers bias exactly the funnel that matters.** A browser-side capture is blocked for
  something like a fifth of visitors, and not a random fifth — a blocker correlates with the
  technical, impatient user most likely to abandon manual entry. That is drop-off measured with the
  bias pointed at the thing being measured.

The distinct id is the user id, which is a UUIDv7 (ADR-0005) and names nobody. No email, no name, no
address is ever sent. The org id rides along as a property, so a funnel can be read per-org without
PostHog holding anything that identifies the org.

**The four funnel events, decided now:**

| Event | Emitted from | Means |
| --- | --- | --- |
| `signed_up` | `resolveActiveOrganization()`, the branch that creates the org | An account exists. Anonymous demo visitors are excluded — they are not signing up |
| `building_created` | `createBuilding()` | Something is in the portfolio |
| `capital_item_added` | `addCapitalItems()` | The differentiator has been reached |
| `forecast_viewed` | the `/forecast` page | The thing that justifies paying has been seen |

Emitted every time, not only the first time. PostHog's funnels take the first occurrence per person
on their own, so a `count(*)` on every create would buy nothing and cost a query on the write path.

**The demo org emits nothing, and not by anybody remembering.** `track()` takes an actor whose
`isDemo` is a required field and returns early when it is set. The demo is a public URL that anyone
can click through and write to (ADR-0011), so within a week it would be most of the funnel —
hundreds of visitors creating a building, not one of them a person deciding whether to pay. A funnel
measuring that measures nothing. Required rather than optional is what stops the next call site from
quietly opting in: there is no default to inherit and no flag to forget.

## Alternatives considered

**GlitchTip, self-hosted, instead of Sentry.** Sentry-protocol-compatible and no vendor. Rejected
because it is a server to run, patch and back up — a second piece of infrastructure for a solo
developer, against a stack that has deliberately stayed managed at every other layer. The bus factor
is already PRD §11's last named risk.

**Plausible instead of PostHog.** The stronger privacy posture out of the box: cookieless,
EU-hosted, nothing personal collected, and a script small enough to be uncontroversial. Rejected on
the funnel. Plausible's custom-event support can count the four events above but its funnel analysis
is thin, and the funnel is the entire reason #36 asks for analytics at all. It is also $9/month with
no free tier against PostHog's free million events, which decides nothing on its own but decides
this when the capability is already behind. The privacy gap that would have justified paying it does
not survive the decision above: with no browser script, no autocapture and no replay, what PostHog
receives here is four event names, two UUIDs and a timestamp.

**Vercel Web Analytics.** Zero setup and already in the platform. Rejected as lock-in pointed
directly at ADR-0002's escape hatch — the one dependency the Dockerfile exists to avoid acquiring —
and its funnel support is the weakest of the three.

**A health route that checks the database.** Rejected above, in the decision.

**Client-side PostHog with autocapture disabled.** The usual middle ground: keep the browser SDK for
page views and manual events, turn the dangerous settings off. Rejected because "off" is a runtime
configuration guarding the largest PII surface in the product, and the alternative is the setting not
existing. The events worth measuring are server facts anyway; only `forecast_viewed` is arguably a
view, and a Server Component renders on every navigation, so the server sees it too.

**Doing nothing until v1.** Tempting, since there are no customers to lose. Rejected because the
funnel is the half that cannot be backfilled: error tracking added later still catches every future
error, but a baseline for onboarding drop-off can only be measured before #39 changes onboarding.

## Consequences

**Easy now.** A crash on the public demo has a stack trace, a release and a commit. A production
question — "did anyone reach the forecast last week" — has an answer. A log line can be filtered by
org without anybody having remembered to include the org. Every one of these works identically on
Cloud Run, because none of them is a Vercel feature.

**Harder now.** Three vendor accounts and five environment variables (`SENTRY_DSN`,
`NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `POSTHOG_KEY`, `POSTHOG_HOST`) that a new environment
needs — all optional, all off when unset, so a laptop and a preview need none of them. `next.config.ts`
is now wrapped by `withSentryConfig`, which means the build has one more thing in it that can break,
and it interacts with the `output: "standalone"` switch that file already explains at length.

**The PII rule is now enforced in three places and understood in one.** `src/lib/query-errors.ts`
strips bound parameters, `beforeSend` strips request data, and `src/lib/log.ts` scrubs values. They
are independent on purpose — each catches what the others do not see — but a fourth route to a
vendor is a fourth place to remember, and this ADR is the list.

**Analytics is the piece most likely to be wrong and least likely to be noticed.** An event that
stops firing looks exactly like a funnel step people stopped reaching. The four events are emitted
from code paths that are already integration-tested, which is the mitigation available without
building a test that asserts against a third party.

**Cost to reverse.** Sentry: an hour, minus the config files. PostHog: less — four call sites and a
module, and no schema, no migration and no stored data depend on any of it. The browser bundle is
unchanged by both, so nothing that ships to a user has to be un-shipped. The expensive part is not
the code, it is the gap in the series: turning analytics off for a quarter and back on leaves a
quarter with no baseline, and the baseline is the reason it is here.

**What this does not do.** It is not an audit log. `recordAccessCodeEvent` still writes a line rather
than a row, and #42 is still the issue that turns reveals into records written in the same
transaction as the read. A log line is evidence; a row is a record, and the difference matters the
first time somebody has to answer for who opened what.
