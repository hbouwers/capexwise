# Observability

The operational half of [ADR-0013](../adr/0013-observability.md): the accounts to create, the
variables to set, and how to check that each piece is actually reporting. The ADR explains the
reasons. This file is the steps.

## What exists

| Piece | Answers | Where it lives | On when |
| --- | --- | --- | --- |
| Sentry | What broke, in which release | `sentry.io`, one project | `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are set |
| Structured logs | What happened, in which org | The platform's log view | Always |
| `/api/health` | Is a server answering | The uptime checker | Always |
| PostHog | Where people stop before the forecast | `posthog.com`, one project | `POSTHOG_KEY` is set |

**Production only.** Every one of these is off on a laptop and off on a preview branch, because the
variables are set in Vercel's **Production** scope and nowhere else. A preview reporting into the
same Sentry project as production makes the production feed useless inside a week, and a preview's
clicks are not a funnel.

## Setup, once

### 1. Sentry

Create an account and **one** project, platform **Next.js**. Do not run the setup wizard it offers
— the code it writes is already in this repository, and it would overwrite
[`next.config.ts`](../../next.config.ts) and both instrumentation files.

From **Settings → Projects → capexwise → Client Keys (DSN)**, copy the DSN. Then, in the Vercel
project, **Settings → Environment Variables**, scope **Production** only:

| Variable | Value |
| --- | --- |
| `SENTRY_DSN` | The DSN |
| `NEXT_PUBLIC_SENTRY_DSN` | The same DSN |

Two variables holding one value, deliberately: they are two switches, so browser reporting can be
turned off without losing the server's. A DSN permits writing events and reading nothing, which is
why the second one is allowed the prefix that publishes it.

For readable stack traces, also add — still **Production** only:

| Variable | Value |
| --- | --- |
| `SENTRY_ORG` | The organisation slug, from the Sentry URL |
| `SENTRY_PROJECT` | `capexwise` |
| `SENTRY_AUTH_TOKEN` | **Settings → Auth Tokens → Create**, scope `project:releases` |

These three are build-time credentials, read by the Sentry build plugin and never by the running
application — which is why they are not in `serverEnvSchema`. Without them the build still succeeds
and errors still arrive; only the source maps are missing, so a browser stack trace reads as minified
names.

### 2. PostHog

Create an account and one project. Note which cloud it is on — the signup default is US, and a key
sent to the wrong host fails at the vendor without saying so.

From **Settings → Project → Project API Key**, copy the key. In Vercel, **Production** only:

| Variable | Value |
| --- | --- |
| `POSTHOG_KEY` | The project API key |
| `POSTHOG_HOST` | `https://eu.i.posthog.com` for an EU project. Leave unset for US |

**Nothing needs to be turned off in the PostHog UI**, because nothing that would need turning off is
ever installed. There is no browser script, so autocapture and session replay have nothing to attach
to. ADR-0013 is the reasoning, and the absence of a `NEXT_PUBLIC_POSTHOG_KEY` is what keeps it true.

Then build the funnel: **Product analytics → New insight → Funnel**, with these four steps in order.

1. `signed_up`
2. `building_created`
3. `capital_item_added`
4. `forecast_viewed`

Set the conversion window to 7 days. The number worth watching is step 2 → step 3: that is manual
entry, which PRD §11 names as the most likely reason a trial user churns, and #39 is the issue that
owns fixing it.

### 3. The uptime check

Any checker that can hit a URL on a schedule. Better Stack and UptimeRobot both have a free tier that
covers this; nothing here depends on which.

| Setting | Value |
| --- | --- |
| URL | `https://capexwise.com/api/health` |
| Method | `GET` |
| Interval | 5 minutes |
| Expect | HTTP `200`, body containing `"status":"ok"` |
| Alert after | 2 consecutive failures |

Two failures rather than one: a single missed check on a serverless platform is usually a cold start,
and an alert that cries wolf is an alert that gets muted.

**The check proves that a server is answering, and nothing more.** It does not touch the database —
ADR-0013 says why, and the short version is that the database being gone is something Sentry reports
within seconds and with the SQLSTATE attached.

## Checking it works

### Sentry

The honest test is an error on a real deploy. There is no test route for this, deliberately — a
route that throws on request is a route somebody can call.

After the next deploy that has the variables set, trigger a failure the ordinary way and confirm it
arrives, then confirm what arrived is safe:

- The event's **Request** section shows a URL with **no query string**, and **no** headers, cookies
  or body.
- There is **no user** on the event.
- The **release** is the commit sha, and matches `/api/health`.
- There are **no `ui.click` breadcrumbs**.

Those five are [`src/lib/sentry-scrub.ts`](../../src/lib/sentry-scrub.ts) doing its job, and they are
held by its unit test — but the unit test asserts against an event shaped like Sentry's, and this
asserts against Sentry's.

### The logs

Every line the application writes is one JSON object with `log`, `level`, `org_id` and `at`. In
Vercel's log view, filter on `"log":"funnel"` to see the funnel events, which are written whether or
not PostHog is configured.

Nothing in a log line should ever be a person's name, email, phone number or an access code. If one
appears, [`src/lib/log.ts`](../../src/lib/log.ts) is where the field list and the scrubber are.

### PostHog

Events show in **Activity** within about a minute of a real sign-up. If they do not, look for
`"log":"analytics_failed"` in the platform's logs first — analytics never breaks a request, so a
misconfiguration is silent everywhere except that line.

## When it goes wrong

**No events in Sentry after a deploy.** Check `/api/health` reports the commit you expect. If the
release is `unknown`, the deploy was not built by Vercel and `VERCEL_GIT_COMMIT_SHA` was unset —
everything still reports, just untagged.

**Stack traces are minified.** `SENTRY_AUTH_TOKEN` is missing or expired. The build log says so and
succeeds anyway; that is by design, because the container build runs with no environment at all.

**A flood of preview errors in the production project.** A DSN was set at project scope rather than
Production scope. Move it, and delete the events.

**The funnel's first step is missing but the rest are there.** `signed_up` fires once per account,
from [`src/server/auth.ts`](../../src/server/auth.ts), so an existing account will never emit it. Test
with an account that has never signed in.

**The funnel looks impossibly healthy.** Demo traffic should be excluded by construction — `track()`
returns early for the demo org — so this means an org has `is_demo` set wrong rather than that the
filter failed. Check `organizations.is_demo`.
