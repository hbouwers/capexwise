# ADR-0004: Auth provider

**Status:** Accepted
**Date:** 2026-09-07 (accepted 2026-09-09, when #25 wired it)
**Decided by:** Holden

## Context

F9 puts email auth, organizations, memberships and roles in v0, and ADR-0003 has already fixed the
shape they take: `organizations` / `users` / `memberships` in our own Postgres, `org_id` on every
domain table leading every index, org context resolved server-side from the session and never from
the client, with row-level security as a second layer before the first paying customer.

Three things about this project narrow the choice more than the usual auth comparison does:

1. **The org model is the tenancy boundary**, not a convenience. Whatever owns it owns the thing
   that RLS keys off. Two sources of truth for membership is a security question, not a
   synchronisation inconvenience.
2. **The demo org resets nightly** (v0.5) and is the public artifact. Anything that makes seeding
   and tearing down orgs harder is a direct cost to the milestone.
3. **Goal 2 is that the repo generates technical discussion about multi-tenancy.** A dependency
   that hides the multi-tenancy hides the thing the repo exists to show.

Two scheduling couplings also hang off this decision. Magic-link sign-in needs a transactional
email provider (#37, currently v1) and a DKIM-verified sending domain (#3, currently unbought), so
choosing magic links for v0 pulls both forward. And ADR-0002 keeps Cloud Run as an escape hatch, so
anything that assumes Vercel-specific edge middleware costs us on the way out.

Facts below were checked on 2026-09-07 against primary sources; the npm figures come from the
registry rather than from documentation, because this is exactly the claim that documentation gets
wrong.

## Decision

**Better Auth**, with its `organization` plugin, running against our own Postgres through the
official Drizzle adapter. **Our database is authoritative for organizations and memberships.**

Three sub-decisions that follow, recorded here because they are the parts that get re-litigated:

- **Google OAuth is the only sign-in method in v0.** No passwords, therefore no password reset and
  no email verification to own. Magic links are added at v0.5 or v1, once a sending domain exists
  for org invitations anyway. This keeps #37 in v1 and leaves #3 unforced.
- **`getOrgContext()` treats the session's `activeOrganizationId` as a hint, not an authority.** It
  re-checks membership against our own table on every request before setting `app.current_org_id`.
  The session says which org the user is *asking* for; the join says whether they may have it.
- **The demo org is seeded and reset in SQL**, on the same migration and seed path as every other
  table, with no external API in the loop.

## Alternatives considered

**Auth.js (NextAuth) v5** — the obvious default, and the option this ADR was expected to pick. It
loses on two counts. First, v5 has not shipped: on 2026-09-07 the npm dist-tags for `next-auth` are
`latest: 4.24.15` and `beta: 5.0.0-beta.32`, both published 2026-07-20, after roughly three years
of betas. Second, and more important, Auth.js has no organization primitive at all — invitations,
role assignment, active-org switching and the invite-token lifecycle would all be hand-rolled.
Better Auth offers the same property that made Auth.js attractive here (the tables are ours) with
that work already done and reviewed.

**Auth.js v4**, the stable line, was considered and rejected: it predates the App Router, which is
the thing v5 exists to address and the stack ADR-0001 committed to.

**Clerk** — rejected, but *not* on cost, and it is worth recording that the cost objection does not
survive contact with the pricing page. Organizations are included on every plan up to 100 monthly
retained organizations at 20 members each, then $1/org/month; Pro is $25/month. A hundred paying
customer orgs would cost roughly $25/month, which is noise. Clerk loses on three other things:

- **Authority.** Org identity would live in Clerk with our Postgres as a mirror maintained by
  webhooks. A missed webhook means our `memberships` table and our RLS policy disagree with
  reality, silently, on the tenancy boundary. That is the one place in this system where a
  consistency bug is a data breach rather than a bug.
- **The demo org.** Nightly reset becomes create-and-destroy against a rate-limited external API
  instead of a transaction.
- **Goal 2.** It hides the multi-tenancy work, which is the part of this repo meant to be read.

Its default `admin`/`member` roles would have covered the PRD's owner/member requirement; custom
roles sit behind a $100/month add-on, which is worth knowing but was not decisive.

**Hand-rolling sessions and OAuth** — rejected. Token exchange and session handling are where
hand-written auth actually fails, and there is no portfolio credit for reimplementing a solved
primitive slightly worse.

**Supabase Auth** — rejected. It brings a second Postgres and a second vendor into a stack that
ADR-0001 deliberately kept as plain Postgres plus Drizzle.

## Consequences

**What this makes easy.** There is one database and one source of truth. The organization tables
are Drizzle tables in our migrations, so the cross-org isolation test (#27) covers them the same way
it covers every other table, and RLS has nothing to reconcile against. Nothing external is needed to
sign in during v0, so the email provider and the domain purchase both stay where they are. The
package is MIT, requires no vendor account, and moves to Cloud Run with the rest of the code.

**What this makes hard.** We own the security surface — session cookies, CSRF, invite-token
expiry — in the sense that a published CVE is an upgrade we have to notice and apply. Better Auth
is also the youngest option here: 1.0 landed in November 2024 and 1.7.3 shipped on 2026-09-06, an
active but fast-moving release cadence, so minor-version API churn is a live risk. Both point at
the same mitigation: pin an exact version, watch releases deliberately, and do not float. There is
no hosted UI, so sign-in, the org switcher and the invitation screens are ours to build against the
component library (#11). Finally, the plugin's generated schema uses its own table and column
conventions; reconciling those with ours is a small one-time decision that belongs in
`docs/data-model.md` (#9), not here.

**Cost of reversal.** Moving to Clerk later means migrating user identities — re-authenticating
each user, or importing them — while keeping our own organization tables and using Clerk purely as
an identity provider. That is days of work, and it is days precisely *because* we did not let Clerk
own the orgs. The reverse move is the expensive one: starting on Clerk Organizations and leaving
means rebuilding the org model and backfilling it from their API, against live customers. That
asymmetry is what decides this ADR. If the recommendation here is wrong, it is wrong in the
cheap direction.

## What #25 settled

Four things this ADR left as intentions and the implementation had to resolve. Recorded here
because each is a decision, not a detail, and the file that made it is not the file anybody reads
first.

**`better-auth@1.7.3`, pinned exactly, no caret.** This ADR committed to pinning; the version is
written down so an upgrade is a diff. The mapping in `src/server/auth.ts` is written against the
schema *that* version reports, and `advanced.database.validateSchema` — on by default — turns a
mismatch after an upgrade into a boot failure naming the field.

**The database generates ids** (`advanced.database.generateId: false`), which is what makes
`organizations.id` a `uuid` from `uuidv7()` rather than Better Auth's random string.
`docs/data-model.md` §2 already required this; the option name was left to be confirmed and this
is it.

**The plugin knows only two roles.** `roles: { owner, member }` on the organization plugin, so it
cannot write `"admin"` into a `membership_role` column that has no such value. The plugin's own
permission sets for those two names are taken unchanged.

**Org creation is closed** (`allowUserToCreateOrganization: false`), and that is a pricing decision
as much as a scope one: the free unit is per *account*, not per org, so an endpoint that lets
anyone mint organizations is an endpoint that hands out free units. The only organization anybody
creates in v0 is their first, and a `databaseHooks.session.create.before` hook makes that one — as
a session is created rather than as a user is, so that it is idempotent and repairs a
half-finished sign-up on the next attempt.

One consequence worth stating plainly, because it is the cost side of "we own the security
surface": **rate limiting is ours now.** It is on in every environment, not only production, and
counts in the database rather than in memory — on Vercel each serverless instance keeps its own
counter, so an in-memory limit is barely a limit against exactly the traffic worth limiting. That
adds a `rate_limits` table this ADR did not anticipate.

## Deliberately left open

- Whether Google is the only OAuth provider at v0.5. GitHub is a reasonable second for a
  recruiter-facing demo, and it is cheap either way.
- Whether invitations ship in v0 at all. The PRD puts memberships in v0, but the second human being
  who needs one is a v1 concern. The table exists — the plugin requires it — and #30 owns the flow.
- Whether the session's five-minute cookie cache is the right window. It trades a database read per
  request against a revoked session staying usable for that long. It is safe at any window for the
  tenancy boundary, because the org id it caches is re-checked against `memberships` regardless;
  the question is only about revocation latency, and there is nothing to revoke yet.

## Sources

- npm registry, `next-auth` and `better-auth` dist-tags and publish dates — checked 2026-09-07
- [Better Auth organization plugin](https://www.better-auth.com/docs/plugins/organization)
- [Better Auth Drizzle adapter](https://www.better-auth.com/docs/adapters/drizzle)
- [Clerk pricing](https://clerk.com/pricing) — checked 2026-09-07
