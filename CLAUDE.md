# CapExWise — working notes

Capital planning for small residential landlords. Solo project, owned by Holden (`hbouwers`).
Companion to Zillow Rental Manager, not a replacement: Zillow keeps rent collection, leases,
listings, tenants and messaging; this owns the capital asset lifecycle, CapEx forecasting, tax
planning, maintenance scheduling, vendor contacts and building operational facts.

**Status: pre-implementation.** There is no application code yet. Rules below that describe
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
| `docs/data-model.md` | Schema, indexes, deletion behaviour — **not written yet**, see #9 |
| `docs/ui/tokens.md` | Design tokens — **not written yet**, see #10 |
| `docs/ui/components.md` | Component inventory — **not written yet**, see #11 |
| `docs/ui/screens/` | One markdown spec per screen — **not written yet**, see #12 |
| `docs/ui/reference/rental-manager.html` | The design prototype. Visual source of truth |

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
| Name | **CapExWise**, `capexwise.com` registered 2026-09-08 (#3). Repository and Vercel project take the same name. The trademark search is still outstanding — clear it before #32 creates the Vercel project and before the repo goes public at v0.5 |
| Building vs unit | A **building** is the address; a **unit** is a separately-leased space inside it. Two duplexes are two buildings and four units. Capital items and tasks carry a nullable `unit_id` — null means building-shared (#48). Never call a building a property; three uses of "property" in the docs are a tax or trade sense and are deliberately left alone |

## Still open — check before building on them

- **Pricing shape, and free tier vs trial** (#13). Changes the plan gate and the onboarding funnel.
- **Whether v1 needs expense entry** (#13, question 5). The income half is settled — rent periods
  give both monthly cash flow and the tax planner's annual figure for one click per unit per month
  (#48). Money-out is what is still open, and it is the largest scope item left in v1.
- **Trademark clearance on "CapExWise"** (#3). The name and the domain are settled; the search
  against existing marks in property-management software is not done. Clear it before #32 and
  before v0.5 — renaming is free today and expensive once a demo URL is public.

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
