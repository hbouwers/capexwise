# CapExWise — working notes

Capital planning for small residential landlords. Solo project, owned by Holden (`hbouwers`).
Companion to Zillow Rental Manager, not a replacement: Zillow keeps rent collection, leases,
listings, tenants and messaging; this owns the capital asset lifecycle, CapEx forecasting, tax
planning, maintenance scheduling, vendor contacts and building operational facts.

**Status: scaffolded, not yet functional.** The Next.js application builds and serves a
placeholder page; there is no database, no auth, and no feature code. Rules below that describe
runtime behaviour describe what the code *will* do — they are the contract to build against, not
a description of something already working. Anything already true is marked as such.

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
| `docs/ui/screens/` | One markdown spec per screen — **not written yet**, see #12 |
| `docs/ui/reference/rental-manager.html` | The design prototype. Visual source of truth |

### Source layout

`src/` is the application; everything under it is TypeScript. The `@/*` import alias maps to
`src/*` — use it rather than relative paths that climb out of a directory.

| Path | What it holds |
| --- | --- |
| `src/app/` | Routes. App Router segments, layouts, pages. Server Components by default; `"use client"` is opt-in and stays as far down the tree as it can |
| `src/components/ui/` | shadcn/ui primitives as generated. Restyled to the tokens, not rewritten |
| `src/components/` | Composed application components, grouped by feature once there is more than one |
| `src/server/actions/` | `"use server"` mutations, one file per domain area. Every one starts with `getOrgContext()` |
| `src/server/queries/` | Read paths, org-scoped, one file per domain area. Called from Server Components; never from the client |
| `src/server/org-context.ts` | `getOrgContext()` and the scoped `db.forOrg(orgId)` (#26). One of the two files allowed to import the raw client |
| `src/db/schema/` | Drizzle table definitions, one file per domain area, matching `docs/data-model.md` |
| `src/db/client.ts` | The raw database client. Importing it from anywhere else is an ESLint error (#16) |
| `src/lib/` | Framework-free helpers — money, dates, formatting. No React, no database, no request context. This is what the unit tests cover |
| `drizzle/` | Generated migrations, committed (#17) |
| `e2e/` | Playwright specs (#21). Unit tests are colocated as `*.test.ts` next to what they test |

Directories appear when there is something real to put in them; this table is the convention,
not a skeleton to pre-create.

## Hard rules

These are the ones that are expensive or impossible to fix later. Everything else is style.

- **`org_id` on every domain table, leading every index.** One codebase serves a personal org, a
  public demo org, and customer orgs. There is no second deployment to hide behind.
- **Org context is resolved server-side from the session. Never from the client.** Not a route
  param, not a header, not a request body. A client-supplied org id is ignored, not validated.
- **Never import the raw database client.** Use `getOrgContext()` and the scoped `db.forOrg(orgId)`
  it returns. An ESLint rule enforces this (#16); wanting to route around it is the signal to fix
  the helper's ergonomics, not to add an exception.
- **Money is integer cents.** Never a float, never a `numeric` round-tripped through JavaScript.
  One `Money` type, one formatter.
- **Identifiers are non-sequential** (UUIDv7 or ULID — #8). Sequential ids on a multi-tenant
  product leak portfolio size to anyone who can read a URL.
- **Never log an access code, and never log PII.** Access codes are encrypted at rest and masked
  by default (#31). Log that a reveal happened, never the value.
- **The tax surface has to be traceable.** Every figure on a tax page traces to its inputs, and the
  disclaimer — a planning aid, not tax advice, confirm with a CPA — is a stated PRD requirement,
  not a nicety. Wrong numbers on a tax page are worse than no tax page.
- **Do not store SSNs, full bank account numbers, or screening reports.** A PRD non-goal, and a
  data-custody line that belongs in the schema rather than in prose.

## Conventions

- **Branch per issue**, named `type/short-description` — `feat/`, `fix/`, `docs/`, `chore/`,
  `refactor/`. One open PR at a time where practical.
- **Never push to `main`.** The one exception was the bootstrap commit, which had no base branch
  to target.
- **Squash merge only.** Merge commits and rebase merges are disabled at the repository level,
  branches delete on merge, and history stays linear by construction.
- **Small commits inside one PR**, each standing alone: green build, green tests, and a message
  saying what it does and why. The commit is the review unit.
- **Close issues from commit messages** — `Closes #12`. The board picks it up.
- **Run `/code-review` before opening any PR that touches code.** Markdown-only changes skip it.
- **UI changes get screenshots on the PR**, desktop and 375px where layout is affected.
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

- **The forecast maths and the tax maths get real unit tests.** They are the product. UI does not
  need coverage targets.
- **One cross-org isolation test, extended per table** (#27). Any migration that adds a table
  extends it — this is on the PR checklist.
- Both suites run in CI on every PR (#22).

## Decided, and not up for re-litigation

| | |
| --- | --- |
| Stack | Next.js App Router + TypeScript + Postgres + Drizzle + Tailwind/shadcn. Rejected: a Next + .NET split, which doubles ceremony for a solo dev |
| Hosting | Vercel now, Cloud Run as the escape hatch. **Vercel Hobby forbids commercial use, so Stripe going live forces the move** — the Dockerfile is maintained from commit one so that stays an afternoon |
| Zillow integration | **Not possible.** Their public APIs cover listing feeds, leads, Zestimates and public records only, never a landlord's own Rental Manager data. Manual entry in v1, which makes onboarding speed a first-class design problem (#39) |
| Licence | All rights reserved. Public as a portfolio artifact, not open source. Reversible toward permissive; the other direction is not |
| Demo city | **Indianapolis**, matching the PRD and the real portfolio. The prototype's Somerville, MA data is presentation only |
| Land vs building basis | Split on `buildings` from the start (#9). Depreciation applies to the building portion only, so without it the tax planner is wrong in year one, not year two |
| Auth | Better Auth + its `organization` plugin, orgs and memberships in our own Postgres ([ADR-0004](docs/adr/0004-auth-provider.md)). Google OAuth only in v0 — no passwords, no email provider, no domain. Rejected: Auth.js (v5 still beta, no org primitive) and Clerk (would own the tenancy boundary) |
| Name | **CapExWise**, `capexwise.com` registered 2026-09-08 (#3). Repository, board and Vercel project take the same name |
| Trademark | **Do not register yet** (#3). Rights come from use in commerce, and an Intent-to-Use filing keeps priority available later, so registration waits for the first paying customer, public launch, or real branding spend. "CapExWise" is suggestive-to-descriptive in a category already full of CapEx-named tools, so it is a weak mark and early registration buys little. **Clearance came back clear on 2026-09-08** and no longer blocks #32 or v0.5 — USPTO turned up nothing on the exact string or on confusingly similar marks, and the sweep for unregistered common-law users found none. Use ™ freely; **® is unlawful before registration**. Not legal advice; an attorney gives the real opinion before any money is spent on branding |
| Pricing | **$5 per unit per month, first unit free permanently, no trial and no card to start** (PRD §12, questions 2–3). The free tier *is* the trial: a clock short enough to convert expires long before a tax-year or ten-year instrument pays off, and it would run during manual entry. Gating is by capacity, never by feature — hiding the forecast hides the thing that justifies paying. The free unit is per **account**, not per org. Conversion event is the second rental, not a timer. Left to the billing work: a taper above ~10 units, and an annual plan |
| Dark mode | **Out of scope through v1** ([tokens](docs/ui/tokens.md) §12). The palette is warm paper: four surfaces within 5% luminance of each other, hierarchy carried by 1px borders rather than shadow, status as dark-on-pale-tint. An inversion is a second design needing its own accessibility pass, not a token swap. Reversal stays cheap because every value is a semantic custom property and no component references a primitive |
| Typeface | **IBM Plex Sans + IBM Plex Mono**, self-hosted via `next/font`, weights 400/500/600 ([components](docs/ui/components.md) §12). Every number that is a *value* renders in the mono; everything else in the sans. Rejected: the prototype's system stack — Arial and Segoe UI have no Medium, so 45 deliberate 500/600 weights collapse to two on Windows, and their digits are unrelated to the mono's |
| Expense entry | **In v1** (PRD §12, question 5). Rent periods gave money-in; without money-out the F0 cash flow tile is half a number and the F4 Schedule E runs on assumptions. `transactions` was already fully specified in [data-model](docs/data-model.md) §6, so this cost no schema design — the migration ships with the feature. Still the largest single scope item in v1, and it adds a screen the prototype never drew (#12) |
| Building vs unit | A **building** is the address; a **unit** is a separately-leased space inside it. Two duplexes are two buildings and four units. Capital items and tasks carry a nullable `unit_id` — null means building-shared (#48). Never call a building a property; three uses of "property" in the docs are a tax or trade sense and are deliberately left alone |

## Still open — check before building on them

- **How deep portfolio-level forecasting goes in v1** (#13, question 6). The dashboard rollup is
  settled and in v1. What is open is whether the 10-year forecast and the reserve projection get a
  portfolio view in v1 or stay per-building until v1.1 — an F3 scope question.
- **How opinionated the default service lives are** (#13, question 4). National defaults with an
  override, or ask for a climate zone during onboarding. Drives the `capital_item_types` seed, so
  it wants answering before #34 rather than after.

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
- Docker is not installed yet (#18). Local Postgres depends on it, and so does keeping the
  Dockerfile honest.
- **Node 24.** Pinned in `.nvmrc` and in `engines`, and Vercel runs 24 LTS for both builds and
  functions. The major is the contract; CI reads `.nvmrc` and the Dockerfile pins a base image
  digest, so nothing else needs to agree on a patch number.
- **ESLint stays on 9.** `eslint-config-next` still peers on `<10` through
  `eslint-plugin-react`, and ESLint 10 crashes on rule load rather than degrading. Re-test on the
  next `eslint-config-next` major before bumping.
