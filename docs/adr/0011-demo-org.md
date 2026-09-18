# ADR-0011: The demo org — anonymous visitors, and a reset that bypasses nothing

**Status:** Proposed — accepted on merge of the PR that adds it
**Date:** 2026-09-17
**Decided by:** Holden

## Context

v0.5's definition of done is a link someone clicks in an interview, and understanding the product
within ninety seconds (PRD §8). PRD F9 adds that **the demo needs no account**: evaluation happens
before sign-up, which is what lets the free tier be card-free. #34 lists the parts: a seed that can
be run again safely, an Indianapolis portfolio of five buildings and eight doors, a nightly reset,
and a demo sign-in that is hard-blocked from writing outside the demo org.

Several things were already true and constrain the answer:

- **Google OAuth is the only sign-in method** ([ADR-0004](0004-auth-provider.md)), and org
  creation is closed (`allowUserToCreateOrganization: false`), because the free unit belongs to the
  account, not to each org it creates.
- **The demo org is a row** ([ADR-0003](0003-multi-tenancy.md)): `organizations.is_demo`, with at
  most one enforced by `organizations_one_demo`. ADR-0003 and
  [ADR-0007](0007-database-roles.md) both expected the reset to be "the first maintenance job that
  needs to write across orgs". Both asked that it decide its own role in its own ADR rather than
  inherit a bypass.
- **Two roles already exist.** `capexwise_identity` can read and write `organizations`, `memberships`
  and `users`. `capexwise_scoped` writes one org's rows under its policies. Production logs in as
  `capexwise_app`, which holds both memberships and nothing else.
- **Every domain table references `organizations (id) on delete cascade`** (data-model §9, item 1).
- **Access codes are sealed in the application** with `ACCESS_CODE_KEYS`
  ([ADR-0008](0008-access-code-encryption.md)). Production's keyring lives in Vercel, with one copy
  kept outside it.
- **The nightly job has to survive the move to Cloud Run** ([ADR-0002](0002-hosting.md)): something
  Vercel Cron and Cloud Scheduler can both call.

## Decision

### Visitors are anonymous accounts, one per visit

**Better Auth's `anonymous` plugin**, from the pinned `better-auth@1.7.3`. `Explore the demo` on the
sign-in page posts to `/api/auth/sign-in/anonymous`. That writes a `users` row with
`is_anonymous` set, a placeholder address on `.invalid` and the name "Demo visitor", then creates
a session.

- **The session hook sends an anonymous account to the demo and nowhere else.**
  `resolveActiveOrganization()` in `src/server/auth.ts` gives it a `member` membership in the
  `is_demo` org. It never creates an org for an anonymous account, which would hand out a free unit
  per click.
- **No live demo, no visit.** Where no demo is seeded, or the demo org is soft-deleted, a
  `hooks.before` middleware refuses `/sign-in/anonymous` with a 404 before the plugin writes
  anything, and the sign-in page does not offer the button. Otherwise every environment that never
  runs the reset would collect anonymous users and sessions that nothing deletes.
- **"Hard-blocked from writing outside the demo org" is the boundary everyone already has, not a
  demo check.** An anonymous account holds exactly one membership. Org creation is closed, and
  invitations do not exist yet (#30). `getOrgContext()` resolves the org from that membership, and
  row-level security holds every write to it. No new code path needs to remember that a visitor is
  special.
- **Rate limited at five a minute per address** (`/sign-in/anonymous` in `rateLimit.customRules`),
  because each visit writes three rows. The button is a small client component that posts to the
  endpoint. A Server Action calling `auth.api` directly would skip the limit, because Better Auth
  counts requests in its HTTP handler and nowhere else.
- **Signing in with Google as a visitor** makes the plugin delete the anonymous account. The
  session hook then gives the real account its own org, as for any new sign-up.

### Visitors can change the demo, and the reset repairs it

The demo behaves exactly like the product: Mark done, Add equipment, Update reserve. One visitor's
edits are visible to the next until the reset. That is accepted in exchange for a demo that shows
the product working, not a picture of it.

### The reset needs no bypass role

`resetDemoOrg()` in `src/server/demo.ts`, in **one transaction**:

1. **On the identity path**, as the login role through `capexwise_identity`: delete the org
   `where is_demo`, delete every user `where is_anonymous`, and insert the demo org again under the
   same id and slug. Deleting the org removes every row it owns through `on delete cascade`, which
   Postgres runs as a referential action rather than as a query subject to a policy. Deleting the
   users cascades to their sessions and memberships.
2. **`enterOrg()`** makes the rest of the transaction `capexwise_scoped` in the demo org. This is the
   statement `forOrg().run()` opens with, extracted so the reset can use it inside a transaction it
   already holds. It sits beside `forOrg` on the ESLint import ban.
3. **As the scoped role**, write the content: contacts and their trades, buildings, units, facts,
   utilities, sealed access codes, capital items with one replacement in their history, tasks, and
   six months of rent. Every row passes the same policies as a request's.

A failed seed rolls back the delete, so last night's demo stays up. Running the reset twice leaves
the same demo, which is what "idempotent" means for a job whose purpose is to start over. The
integration test runs it as `capexwise_test_app`, the restricted login, so a step that needed more
than those two roles would fail there with `permission denied`.

### The content is code, dated from today

`demoPortfolio(today)` in `src/lib/demo-portfolio.ts` is a pure function. It returns content with
no ids or org: install years are ages, due dates are offsets from today, and rent covers the six
months up to the current one, all in Indianapolis time. A demo seeded with fixed dates goes stale
within a month. Addresses are invented, phone numbers are in the 555-01xx block set aside for
fiction, and email domains are `.example`.

### A route, called nightly

`GET /api/cron/demo-reset`, authorised by `Authorization: Bearer <CRON_SECRET>` and compared in
constant time. With no `CRON_SECRET` set, the route answers 404, so every environment but the one
that hosts the demo has it off by default. `vercel.json` schedules it at 08:00 UTC, which is 3 or
4am in Indianapolis. Vercel Cron sends the header by itself when the project has the variable, and
Cloud Scheduler can be told to send the same one. `npm run demo:reset` calls the same route by hand.

## Alternatives considered

**One shared demo user.** Every visitor gets a session for a single seeded account, so no user rows
pile up. It lost on mechanism. Better Auth has no supported way to hand a stranger a session for an
existing user, so it would be a hand-built session outside the library's endpoints, rate limit and
origin check. Every visitor would also share one identity, so one visitor's sign-out would sign
everyone out.

**A read-only demo.** Nothing to vandalise, but every server action would need a demo guard, and a
guard missed on one action is a write in a demo that promised none. It also hides the part worth
showing. A nightly reset repairs vandalism by itself.

**A maintenance role with `BYPASSRLS`, or the table owner.** This is what ADR-0003 and ADR-0007
expected. The reset turns out not to need it. The only write outside one org's policies is the
delete of the org row, which the identity path could already make. A role that can write every
org's rows would be the most dangerous grant in the database, and nothing here needs it.

**A GitHub Actions workflow, like the backup** ([ADR-0010](0010-backups.md)). It keeps the reset off
the public internet, but it would need its own copy of production's `ACCESS_CODE_KEYS` in GitHub to
seal the demo's codes. Keeping fewer copies of that keyring is ADR-0008's whole point. It would also
have to import the application's TypeScript under plain Node, where the `@/` alias does not
resolve. The route runs where the keyring and the schema already are.

**Content as SQL, or in a migration.** Migrations are forward-only and run everywhere, and the demo
is content for one org, not the schema's contract (data-model §6). Fixed SQL also cannot date
itself from today.

**Truncating the demo's tables in place instead of deleting the org.** The scoped role holds no
`DELETE` on `contacts`, `building_facts`, `rent_periods` or `capital_item_allocations`, deliberately
(§7). Granting deletes to the product's role so that a maintenance job can use them would widen what
every request can do.

## Consequences

**What this makes easy.** A recruiter clicks once and is inside a populated portfolio. Every screen
has something to show on any night of the year. The reset is one transaction through roles that
already exist, so there is no new bypass to audit. It moves to Cloud Run as a scheduler entry. A
preview deployment can show signed-in pages through the demo, because anonymous sign-in needs no
OAuth redirect, as long as that preview's database holds a demo. For now it does not:
[ADR-0012](0012-preview-base-branch.md) starts previews from an empty base and defers seeding one.

**What this makes hard.**

- **Vandalism is visible until 08:00 UTC.** Whatever one visitor writes, the next one sees. If it
  becomes a problem, `npm run demo:reset` is the immediate fix. A more frequent schedule needs a
  paid Vercel plan or Cloud Scheduler.
- **A visitor mid-demo at reset time sees an error for up to five minutes.** The session cookie
  cache (ADR-0004) still holds the deleted visitor's session, and `getOrgContext()` finds no
  membership for it. Once the cache expires, the next request goes to sign-in. The window is five
  minutes at 3am in Indianapolis, so it is accepted rather than routed around.
- **`users` gains one row per visit**, removed nightly. ADR-0012 keeps these rows out of preview
  branches. They identify nobody: no email a person owns, no name, no provider
  account.
- **The demo org's plan is `free`** and holds eight units. No capacity check exists yet. ADR-0009
  leaves how the demo holds more than the free unit to the billing work, and that work has to cover
  it.
- **The content is a second consumer of the schema.** A migration that adds a required column to a
  table the demo writes breaks the reset, and the integration test is what catches it.

**Cost of reversal.** Low. Removing the demo is removing the plugin, the route, the `vercel.json`
entry and one sign-in button. `users.is_anonymous` can stay as a column nothing sets. Moving to a
maintenance role later would change the first step of `resetDemoOrg()` and nothing that calls it.
