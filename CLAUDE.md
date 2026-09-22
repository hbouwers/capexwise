# CapExWise — working notes

Capital planning for small residential landlords. Solo project, owned by Holden (`hbouwers`).
Companion to Zillow Rental Manager, not a replacement: Zillow keeps rent collection, leases,
listings, tenants and messaging; this owns the capital asset lifecycle, CapEx forecasting, tax
planning, maintenance scheduling, vendor contacts and building operational facts.

**Status: the tenancy spine, the app shell and the first feature are in.** The application signs
in with Google, creates the account's org and owner membership, and protects its routes — #25. The
schema through `docs/data-model.md` §2 is migrated, with row-level security on every table that
carries an org — #28. Every signed-in screen renders inside the shell — rail, org switcher, the
`can(org, feature)` plan gate — #29. Money and dates have their one formatter each — #104.
Buildings and units are stored, entered through the building form, and shown on the building's page
and the portfolio's cards — #105. Contacts and their trades are stored and kept in the contact book,
with the first reference data seeded by a migration — #106; the other three destinations are
placeholders. A building's facts — collection days, utilities and services, and access codes sealed
in the application and revealed one at a time — are on its page — #107. Rent is tracked a month at
a time on the building's rent roll, with the Paid checkoff, a month that stood vacant, and rent
recorded for a unit that was let then — #108. The capital item catalogue is seeded with sourced
national defaults, and capital items and their explicit splits are stored, with the allocation rule,
adding from the catalogue and recording a replacement behind them — #109. Equipment is added from the
catalogue checklist, confirmed, and shown in the building's equipment table, with the install-year
seed, the replacement year and the life status as tested rules in `src/lib/forecast/` — #110.
The forecast's arithmetic is written and tested there too — ten years of replacements with audited
and estimated cost apart, the reserve projection and its monthly need, level funding, deferral, and
the building flag — #111. The forecast page reads it at `/forecast`, portfolio-wide or by building,
with `What if?` deferral and the reserve entered through `Update reserve`, and the building page's
capital tiles and replacement runway read the same module — #112. Tasks are stored, with a
confirmation and a member as assignee (#93, #94), and shown at `/maintenance` and in the building
page's recurring tasks, where checking one off writes its next occurrence — #113. A task is added,
read and edited in full in the task modal at `?task=`, with its confirmation, Mark done, Cancel task
and the contacts tagged with its trade — #114. The portfolio at `/` is finished: the four v0 tiles,
the building cards' rent, CapEx, tasks, flag and systems life, the replacement runway and what is
due in the next 30 days — #115. An item is edited in full in the item editor, opened from the
equipment table's Item button, with Record replacement, Remove and Confirm in it, and a building's
replaced and removed equipment shown on request — #125. The demo org is written by a nightly reset
at `/api/cron/demo-reset` — five Indianapolis buildings and eight doors, dated from today — and
`Explore the demo` signs a visitor in anonymously, into the demo alone — #34. The application now
reports on itself: errors to Sentry with the request stripped off them, one JSON line per event
carrying the org, `/api/health` for an uptime check, and the four onboarding funnel events measured
on the server — #36, [ADR-0013](docs/adr/0013-observability.md). The tax planner and the rest of what the
product is *for* are still unwritten. Rules below that describe runtime behaviour describe what the code *will*
do — they are the contract to build against, not a description of something already working.
Anything already true is marked as such.

Read `docs/PRD.md` first. It is the product brain and it is current.

## Where things live

The git repository is the checkout folder; its parent working directory is deliberately
**outside git** — scratch files, helper scripts, secrets, and anything not meant to be published.
On this machine those are still `propex/` inside `propex-working-directory/`, from before the
rename. Renaming them locally is cosmetic and changes nothing about the remote.
The repository is private today and flips public at v0.5, so assume anything committed will
eventually be world-readable.

| Path | What it holds |
| --- | --- |
| `docs/PRD.md` | Product requirements. Problem, users, features, release plan, risks, open questions |
| `docs/adr/` | Architecture decision records, plus the template and numbering rules |
| `docs/data-model.md` | Schema, indexes, deletion behaviour, RLS policy template. The contract for the first migration |
| `docs/ui/tokens.md` | Design tokens — colour, type, radius, states. The contract for the Tailwind theme |
| `docs/ui/components.md` | Component inventory — names, layers, shadcn mapping. The contract the screen specs reference |
| `docs/ui/screens/` | One markdown spec per screen and modal, and a README of the rules they all share — widths, tables below `md`, building-or-unit scope, states. The contract a screen is built against |
| `docs/ui/reference/rental-manager.html` | The design prototype. Visual source of truth |
| `docs/runbooks/` | Operational procedures: the steps, where the ADR is the reasons. `backup-and-restore.md` and `observability.md` |
| `CONTRIBUTING.md` | Branch, commit and PR conventions, and the protection to enable at v0.5 |

### Source layout

`src/` is the application; everything under it is TypeScript. The `@/*` import alias maps to
`src/*` — use it rather than relative paths that climb out of a directory.

| Path | What it holds |
| --- | --- |
| `src/app/` | Routes. App Router segments, layouts, pages. Server Components by default; `"use client"` is opt-in and stays as far down the tree as it can |
| `src/instrumentation.ts` | The boot hook Next.js calls before a server instance serves anything. It validates the environment there, so a bad value stops the process instead of surfacing in a request |
| `src/components/ui/` | shadcn/ui primitives as generated. Restyled to the tokens, not rewritten |
| `src/components/` | Composed application components, grouped by feature once there is more than one |
| `src/server/actions/` | `"use server"` mutations, one file per domain area. Every one starts with `getOrgContext()` — `auth.ts` is the one exception, and says why: it runs before there is a session to resolve an org from |
| `src/server/queries/` | Read paths, org-scoped, one file per domain area. Called from Server Components; never from the client |
| `src/server/org-context.ts` | `getOrgContext()` and the scoped `db.forOrg(orgId)` (#26). One of the files allowed to import the raw client |
| `src/server/auth.ts` | The Better Auth provider — the adapter mapping, the Google client, the organization plugin, rate limiting. Also allowed the raw client, for the reason `eslint.config.mjs` gives |
| `src/server/session.ts` | `requireSession()` and `getSession()` — the protected-route pattern, documented once. Identity only; the org is `getOrgContext()` |
| `src/server/env.ts` | The validated environment. Call `env()`, never `process.env`; it is `server-only`, so a Client Component that reaches for it fails the build. It parses on **first use**, not on import — `next build` imports every route module, and a parse at module scope would make the build demand production secrets |
| `src/server/boot.ts` | What `src/instrumentation.ts` runs at startup. Separate from it because that file is compiled for the Edge runtime too, where `server-only` and `process.exit` are a build error and a build warning |
| `src/db/schema/` | Drizzle table definitions, one file per domain area, matching `docs/data-model.md` |
| `src/db/client.ts` | The raw database client. Importing it, or the `pg` driver, from anywhere outside the allowlist is an ESLint error |
| `src/db/migrate.mts` | The migration runner. Forward-only, and it opens its own connection — [ADR-0006](docs/adr/0006-migrations.md) |
| `src/db/backup.mts` | The nightly backup: dump, restore into a scratch database, compare — [ADR-0010](docs/adr/0010-backups.md). Opens its own connections, like the runner |
| `src/lib/env-schema.mts` | The environment contract — the schema, and the parser that formats a failure without printing a value. `.mts` because the migration runner imports it and runs under plain Node |
| `src/lib/env-public.ts` | The `NEXT_PUBLIC_` half, parsed. Importable from a Client Component, which is the whole point of its being a separate module from `@/server/env`. Every variable is spelled literally there, because that is what the compiler inlines |
| `src/lib/log.ts` | One JSON line per event ([ADR-0013](docs/adr/0013-observability.md)). `orgId` is a required argument and values are scrubbed on the way out — this is where "logs never carry PII" stops being a comment |
| `src/server/sentry.ts`, `src/instrumentation-client.ts` | Error tracking, server and browser. Off wherever the DSN is unset, which is every laptop and every preview |
| `src/server/analytics.ts` | The four onboarding funnel events, emitted server-side. No browser script, no autocapture, no replay; the demo org is excluded by a required field rather than by remembering |
| `src/lib/access-code-cipher.mts` | Seals and opens access codes, and parses `ACCESS_CODE_KEYS` ([ADR-0008](docs/adr/0008-access-code-encryption.md)). Takes the keyring as an argument and reads no environment. `.mts` because `env-schema.mts` imports it |
| `src/lib/` | Framework-free helpers — money, dates, formatting. No React, no database, no request context. This is what the unit tests cover |
| `drizzle/` | Generated migrations, committed. Read the SQL before committing it; there is no `down` |
| `src/test/` | The integration harness — test database lifecycle and factories. Loaded by Vitest, never imported by application code |
| `e2e/` | Playwright specs. Vitest tests are colocated: `*.test.ts` for unit, `*.integration.test.ts` for the database-backed ones |

Directories appear when there is something real to put in them; this table is the convention,
not a skeleton to pre-create.

## Hard rules

These are the ones that are expensive or impossible to fix later. Everything else is style.

- **`org_id` on every domain table, leading every index.** One codebase serves a personal org, a
  public demo org, and customer orgs. There is no second deployment to hide behind. And forced
  row-level security with a policy for `capexwise_scoped` — the template is `docs/data-model.md` §9,
  and the isolation test refuses a table without it.
- **Org context is resolved server-side from the session. Never from the client.** Not a route
  param, not a header, not a request body. A client-supplied org id is ignored, not validated.
- **Never import the raw database client.** Use `getOrgContext()` and the scoped `db.forOrg(orgId)`
  it returns. An ESLint rule enforces this (#16); wanting to route around it is the signal to fix
  the helper's ergonomics, not to add an exception. `eslint.config.mjs` lists the files that are
  past it and why each one is.
- **Money is integer cents.** Never a float, never a `numeric` round-tripped through JavaScript.
  One `Money` type, one formatter.
- **Identifiers are non-sequential** (UUIDv7 or ULID — #8). Sequential ids on a multi-tenant
  product leak portfolio size to anyone who can read a URL.
- **Never log an access code, and never log PII.** Access codes are sealed in the application
  before they reach the database, and masked by default ([ADR-0008](docs/adr/0008-access-code-encryption.md)).
  `src/lib/access-code-cipher.mts` is the only code that holds one in plaintext. Log that a reveal
  happened, never the value.
- **A secret never carries a `NEXT_PUBLIC_` prefix.** The compiler inlines any variable with it
  into the client bundle as a literal, so the value is published to every browser and stays
  published in every cached build — removing the prefix afterwards un-publishes nothing.
  `src/lib/env-schema.mts` refuses to start the server if a server variable has one. A value
  reaches the client by being passed down from a Server Component, never by being renamed.
- **The tax surface has to be traceable.** Every figure on a tax page traces to its inputs, and the
  disclaimer — a planning aid, not tax advice, confirm with a CPA — is a stated PRD requirement,
  not a nicety. Wrong numbers on a tax page are worse than no tax page.
- **Do not store SSNs, full bank account numbers, or screening reports.** A PRD non-goal, and a
  data-custody line that belongs in the schema rather than in prose.

## Conventions

- **Branch per issue**, named `type/short-description` — `feat/`, `fix/`, `docs/`, `chore/`,
  `refactor/`. One open PR at a time where practical.
- **Never push to `main`.** The one exception was the bootstrap commit, which had no base branch
  to target. Nothing enforces this: GitHub offers no branch protection or rulesets on a private
  repository outside a paid plan, so it is convention until the repo goes public at v0.5
  ([CONTRIBUTING.md](CONTRIBUTING.md) lists the ruleset to turn on then).
- **Squash merge only.** Merge commits and rebase merges are disabled at the repository level,
  branches delete on merge, and history stays linear by construction.
- **Small commits inside one PR**, each standing alone: green build, green tests, and a message
  saying what it does and why. The commit is the review unit. **No Conventional Commits** — the
  subject is a sentence, and [CONTRIBUTING.md](CONTRIBUTING.md) says why and what to write instead.
- **Close issues from commit messages** — `Closes #12`. The board picks it up.
- **Run `/code-review` before opening any PR that touches code.** Markdown-only changes skip it.
- **Screenshots on a PR are optional.** Holden runs the branch locally, which is a better look at a
  UI change than two stills — so a screenshot is worth attaching only when it shows something a
  local run would not: a state that is awkward to reach, or a before-and-after.
- **Configuration comes from `@/server/env`, not `process.env`.** It is parsed once at boot, so a
  missing or malformed value is a startup error naming the variable. A new variable goes in
  `src/lib/env-schema.mts` *and* `.env.example`; one without the other is half a change.
- Match the style of the file being edited. Plain code, no speculative abstraction.

## Working with the design

The UI handoff order is **tokens, then component library, then per-screen specs**. Build against
those files, not against the prototype directly.

**Never paste design HTML into a prompt.** Reference tokens by name, components by name, and
screens by path. The prototype is 456KB and pasting it burns context for no gain.

**Never sample a colour out of the prototype.** [`docs/ui/tokens.md`](docs/ui/tokens.md) is not a
transcription of it — four of the prototype's seven text greys fail WCAG AA, including the two most
used, so the ramp there is corrected and two hex values are new. A value taken from the prototype by
eye reintroduces a failure that was already found and fixed.

**Never copy the prototype's markup.** It is a picture of the design, not an implementation of
it: zero `<button>` elements, zero `<a>` elements, 43 click handlers on bare `<div>`s, and tables
built from CSS grid with no row or column semantics. [`docs/ui/components.md`](docs/ui/components.md)
§9 lists what does not carry forward.

`docs/ui/reference/rental-manager.html` is a Claude Design bundle, not plain HTML — the real markup
lives inside its `<script type="__bundler/template">` tag as a JSON string. To read it, extract
that tag and JSON-decode it rather than opening the file directly.

The prototype is **desktop-only**, and the PRD commits to responsive web. Mobile behaviour for
every screen is undefined and has to be specified, not improvised (#12).

## Testing

Three suites, and which one a test belongs in is decided by what it needs, not by what it is
about. Anything that can be a unit test is one.

| | Command | Needs | Holds |
| --- | --- | --- | --- |
| Unit | `npm test` | nothing | `src/**/*.test.ts`, colocated |
| Integration | `npm run test:integration` | `npm run db:up` | `src/**/*.integration.test.ts`, colocated |
| End-to-end | `npm run test:e2e` | a browser, a dev server | `e2e/*.spec.ts` |

The integration suite creates `capexwise_test` itself, migrates it, and truncates every table
before each test. It refuses to run against a database whose name does not end in `_test`.

### The coverage stance

- **The forecast maths and the tax maths get real unit tests.** They are the product, they are
  pure functions over integer cents, and a wrong number on a tax page is worse than no tax page.
  This is where thoroughness is spent — edge cases, boundaries, the years a schedule changes.
- **UI does not need coverage targets.** No target, no ratchet, no assertions on markup that will
  be redrawn. The end-to-end suite covers the shell — that a route renders, that the CSS applies,
  that the fonts resolve — and stops there.
- **Test behaviour the database owns, in the database.** Defaults, triggers, partial indexes and
  constraints are claims `npm run typecheck` cannot check. `organizations.integration.test.ts` is
  the pattern.
- **A test whose failure would not change what anyone does is not worth writing.** Prefer one test
  of a real regression — `src/lib/cn.test.ts` is a bug that actually shipped — to ten that restate
  the implementation.
- **One cross-org isolation test, extended per table** (#27):
  `src/server/cross-org-isolation.integration.test.ts`. Any migration that adds a table extends
  it — this is on the PR checklist, and the test itself fails until the new table is named in it.
  `src/test/db.ts` holds an unscoped connection so that test can see the rows a scoped path hides;
  that is the only reason it exists.
- **Factories take an `orgId` as a required first argument**, never an optional one with a default.
  A factory that can invent an org is a way to write a test that passes with tenancy broken.
- All three suites run in CI on every PR, in `.github/workflows/ci.yml`, alongside typecheck,
  lint, formatting, migration drift, `next build` and the container build.

## Decided, and not up for re-litigation

| | |
| --- | --- |
| Stack | Next.js App Router + TypeScript + Postgres + Drizzle + Tailwind/shadcn. Rejected: a Next + .NET split, which doubles ceremony for a solo dev |
| Hosting | Vercel now, Cloud Run as the escape hatch. **Vercel Hobby forbids commercial use, so Stripe going live forces the move** — the Dockerfile is maintained from commit one so that stays an afternoon. **One production at every stage**, at `capexwise.com`; shutting the paid product down moves it back to Hobby ([ADR-0009](docs/adr/0009-one-production.md)). Rejected: a second, Hobby-only deployment for personal use and demos beside the paid one |
| Zillow integration | **Not possible.** Their public APIs cover listing feeds, leads, Zestimates and public records only, never a landlord's own Rental Manager data. Manual entry in v1, which makes onboarding speed a first-class design problem (#39) |
| Licence | All rights reserved. Public as a portfolio artifact, not open source. Reversible toward permissive; the other direction is not |
| Demo city | **Indianapolis**, matching the PRD and the real portfolio. The prototype's Somerville, MA data is presentation only |
| Land vs building basis | Split on `buildings` from the start (#9). Depreciation applies to the building portion only, so without it the tax planner is wrong in year one, not year two |
| Auth | Better Auth + its `organization` plugin, orgs and memberships in our own Postgres ([ADR-0004](docs/adr/0004-auth-provider.md)). Google OAuth only in v0 — no passwords, no email provider, no domain. Rejected: Auth.js (v5 still beta, no org primitive) and Clerk (would own the tenancy boundary). **Pinned to an exact version, no caret** — the ADR's own mitigation for the youngest dependency in the stack, and the mapping in `src/server/auth.ts` is written against the schema that version reports. **No middleware auth check**: middleware sees a cookie, not a validated session |
| Name | **CapExWise**, `capexwise.com` registered 2026-09-08 (#3). Repository, board and Vercel project take the same name |
| Trademark | **Do not register yet** (#3). Rights come from use in commerce, and an Intent-to-Use filing keeps priority available later, so registration waits for the first paying customer, public launch, or real branding spend. "CapExWise" is suggestive-to-descriptive in a category already full of CapEx-named tools, so it is a weak mark and early registration buys little. **Clearance came back clear on 2026-09-08** and no longer blocks #32 or v0.5 — USPTO turned up nothing on the exact string or on confusingly similar marks, and the sweep for unregistered common-law users found none. Use ™ freely; **® is unlawful before registration**. Not legal advice; an attorney gives the real opinion before any money is spent on branding |
| Pricing | **$5 per unit per month, first unit free permanently, no trial and no card to start** (PRD §12, questions 2–3). The free tier *is* the trial: a clock short enough to convert expires long before a tax-year or ten-year instrument pays off, and it would run during manual entry. Gating is by capacity, never by feature — hiding the forecast hides the thing that justifies paying. The free unit is per **account**, not per org. Conversion event is the second rental, not a timer. Left to the billing work: a taper above ~10 units, and an annual plan |
| Dark mode | **Out of scope through v1** ([tokens](docs/ui/tokens.md) §12). The palette is warm paper: four surfaces within 5% luminance of each other, hierarchy carried by 1px borders rather than shadow, status as dark-on-pale-tint. An inversion is a second design needing its own accessibility pass, not a token swap. Reversal stays cheap because every value is a semantic custom property and no component references a primitive |
| Typeface | **IBM Plex Sans + IBM Plex Mono**, self-hosted via `next/font`, weights 400/500/600 ([components](docs/ui/components.md) §12). Every number that is a *value* renders in the mono; everything else in the sans. Rejected: the prototype's system stack — Arial and Segoe UI have no Medium, so 45 deliberate 500/600 weights collapse to two on Windows, and their digits are unrelated to the mono's |
| Expense entry | **In v1** (PRD §12, question 5). Rent periods gave money-in; without money-out the F0 cash flow tile is half a number and the F4 Schedule E runs on assumptions. `transactions` was already fully specified in [data-model](docs/data-model.md) §6, so this cost no schema design — the migration ships with the feature. Still the largest single scope item in v1, and it adds a screen the prototype never drew (#12) |
| Building vs unit | A **building** is the address; a **unit** is a separately-leased space inside it. Two duplexes are two buildings and four units. Capital items and tasks carry a nullable `unit_id` — null means building-shared (#48). Never call a building a property; three uses of "property" in the docs are a tax or trade sense and are deliberately left alone |
| Default service lives | **National defaults, user-overridable** (PRD §12, question 4). The fix for regional variance is a per-org override, not a climate-zone question at signup — onboarding speed is already a first-class design problem (#39). Drives the `capital_item_types` seed (#109): one national default per item type, editable per org, with a visible `defaults_updated_at` |
| Access-code encryption | **AES-256-GCM in the application**, bound to the org, keyed by a per-environment `ACCESS_CODE_KEYS` ([ADR-0008](docs/adr/0008-access-code-encryption.md)). Rejected: `pgcrypto`, which makes the code and the key bound parameters, and Drizzle prints every bound parameter of a failed query; envelope encryption, which buys nothing without a KMS and is the Cloud Run move. Utility `account_ref` stays a four-character stub and is not encrypted |
| Backups | **Nightly `pg_dump` as `capexwise_reader`, restored and compared on the runner before it is kept, `age`-encrypted, in an S3-compatible bucket outside Neon and GitHub, kept 90 days** ([ADR-0010](docs/adr/0010-backups.md)). Neon's 6-hour history covers the hours since. The reader reads through a read policy on every table rather than bypassing row-level security, so every new table needs its `select` grant and, if it has row-level security, the policy — docs/data-model.md §9. Rejected: Neon's backups alone (6 hours, and not independent), dumping as the owner (every domain table comes out empty), GitHub artifacts |
| Portfolio forecasting | **In v1** (PRD §12, question 6). The dashboard rollup (F0) was already settled and in v1; the 10-year forecast and reserve projection get the same portfolio view in v1 rather than staying per-building until v1.1 |
| Reserve timing | **A replacement is paid in January of its year, and contributions since the reserve's as-of date are not counted** (#111, 2026-09-16). Replacements are known by the year and the reserve by the month, so the forecast has to pick a month. Both rules pick the reading that never overstates what the reserve covers: a failure does not wait for December, and CapExWise cannot see the account to know a deposit was made. Rejected: mid-year or year-end payment, and rolling the balance forward by the stated contribution. [capex-forecast.md](docs/ui/screens/capex-forecast.md#ten-year-capital-plan) states them |
| Demo org | **Anonymous visitors, full writes, a nightly reset that bypasses nothing** ([ADR-0011](docs/adr/0011-demo-org.md), #34). Better Auth's `anonymous` plugin makes one account per visit, a member of the `is_demo` org and nothing else. The reset deletes that org on the identity path — the cascade empties it — and writes the content back as `capexwise_scoped`, in one transaction, from a route Vercel Cron and Cloud Scheduler can both call. Rejected: a shared demo user, a read-only demo, a `BYPASSRLS` maintenance role, and a GitHub Actions job holding a copy of production's keyring |
| Preview databases | **Every preview branch is created from `preview-base`, the Neon project's default branch: the migrated schema and the rows migrations write, nothing else** ([ADR-0012](docs/adr/0012-preview-base-branch.md), #85). Neither Neon integration lets a preview choose its parent, so the default branch is the lever. CI migrates the base after production. `main` is still production's branch, and every console step on it has to pick it by name. No demo in previews yet. The base is a child of `main` with its schemas dropped and rebuilt and production's passwords cut, and `Reset from parent` on it would copy production back in. Rejected: branching from `main` and scrubbing, a schema-only base (Neon refuses one in this project, and it would have no migration journal or catalogue) |
| Observability | **Sentry for errors, JSON lines for logs, `/api/health` for uptime, PostHog for the funnel — and nothing of it in the browser except Sentry** ([ADR-0013](docs/adr/0013-observability.md), #36). Analytics is emitted server-side only: no `posthog-js`, no autocapture, no session replay, no cookie and so no consent banner, because autocapture on this product records tenant names and street addresses and cannot be configured safe. The four funnel events are `signed_up`, `building_created`, `capital_item_added`, `forecast_viewed`, and the demo org emits none of them — `track()` takes a required `isDemo` rather than a flag somebody remembers. Every vendor is off where its variable is unset, which is every laptop and every preview. Rejected: GlitchTip (a server to run), Plausible (thin funnels, and the privacy gap that would justify paying it does not survive keeping the browser clean), Vercel Analytics (lock-in aimed at ADR-0002's escape hatch), a health route that queries Postgres (it would need a ninth entry on the raw-client allowlist to buy a signal Sentry already gives) |
| Forecast recurrence | **An item is due again a life after the year it lands, inside the ten years** (#111). Five catalogue types live eight years or less, so counting each item once understates every later year and the reserve need. A recurrence of an estimated item stays estimated, and costs are today's, not inflated. Rejected: one replacement per item. [capex-forecast.md](docs/ui/screens/capex-forecast.md#ten-year-capital-plan) states it |

All six PRD open questions (#13) are now settled — see PRD §12.

## Live state is not duplicated here

It rots. For what is merged, open, or in flight, ask the source:

```bash
git log --oneline main
gh issue list --repo hbouwers/capexwise
gh project item-list 3 --owner hbouwers
```

Board: `github.com/users/hbouwers/projects/3` — Todo → In Progress → Code Review → Testing → Done.
Milestones map to the PRD release plan: v0 personal, v0.5 demo, v1 paid, v2 premium.

## Environment notes

- Windows machine, `core.autocrlf=true` globally. `.gitattributes` pins every text blob to LF, so
  this is handled — but verify with `git cat-file blob <sha> | od -An -tx1 | grep -c 0d`, **not**
  `git show`, which applies EOL conversion and lies.
- PowerShell and bash each need their own syntax. PowerShell splits multi-line strings into
  multiple arguments for `gh`, so use bash with a heredoc for anything multi-line.
- **Docker Desktop is installed** (WSL2 backend), and `npm run db:up` brings up local Postgres 18.
  `npm run db:migrate` applies the committed migrations; a clean slate is `db:reset` then
  `db:migrate`. `npm run docker:up` builds the application image and runs it against that
  database on port 3001 — the local half of what CI now checks on every PR.
- **Node 24.** Pinned in `.nvmrc` and in `engines`, and Vercel runs 24 LTS for both builds and
  functions. The major is the contract; CI reads `.nvmrc` and the Dockerfile pins a base image
  digest, so nothing else needs to agree on a patch number.
- **ESLint stays on 9.** `eslint-config-next` still peers on `<10` through
  `eslint-plugin-react`, and ESLint 10 crashes on rule load rather than degrading. Re-test on the
  next `eslint-config-next` major before bumping.
