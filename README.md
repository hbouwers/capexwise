# CapExWise

Capital planning for small residential landlords.

> **Status: early scaffold.** The product requirements, the design reference and the work
> breakdown exist, and the application builds — but it does nothing yet: no database, no auth,
> no features. See [the project board](https://github.com/users/hbouwers/projects/3) for what is
> in flight.

---

## What it is

Small landlords have good tools for the transactional side of renting. Zillow Rental Manager,
Avail and TurboTenant handle listings, applications, screening, leases, rent collection and
tenant messaging, mostly for free.

Almost none of them handle the *ownership* side. A furnace installed in 2009 is a known, dated,
forecastable liability, and most landlords carry that in their head or not at all. Capital
expenditure arrives in lumps — a roof and an HVAC system in the same year is a five-figure event.
Whether a given spend is a deductible repair or a capitalised improvement materially changes
taxable income, and the *timing* of a discretionary project is one of the few real levers a small
landlord has.

The result is reactive ownership: capital spending gets discovered rather than planned, and tax
planning happens in March for a year that already ended.

**CapExWise owns the capital asset lifecycle.** What is going to break, when, what it will cost,
whether the cash will be there, and what it does to the tax bill.

## Positioning: a companion, not a replacement

This assumes you already run rent collection, leases and tenant communication somewhere else.

| Owned by Zillow / equivalent | Owned by CapExWise |
| --- | --- |
| Listings and syndication | Capital asset inventory and lifecycle |
| Applications and screening | CapEx forecast and reserve planning |
| Lease documents and e-signature | Tax liability estimation and scenario planning |
| Rent collection and payment processing | Recurring and one-off maintenance scheduling |
| Tenant messaging | Vendor and contact book, by trade |
| | Building operational facts (codes, utilities, service days) |
| | Rent roll and rent-received tracking (manual — no money moves) |

*Zillow handles the money coming in. This handles what is going to break, when, what it costs,
and what it does to your taxes.*

**There is no integration path.** Zillow Group publishes APIs for listing feed syndication, lead
delivery, Zestimates and public records — none of which expose a landlord's own Rental Manager
data. Manual entry is a stated non-goal to fix, not a deferred feature, which makes onboarding
speed a first-class design problem.

## Stack

| | |
| --- | --- |
| Framework | Next.js (App Router), TypeScript |
| Database | Postgres, Drizzle ORM and migrations |
| UI | Tailwind CSS, shadcn/ui |
| Auth | Better Auth, with organizations and memberships in our own Postgres — [ADR-0004](docs/adr/0004-auth-provider.md) |
| Billing | Stripe (v1) |
| Hosting | Vercel, with a maintained Dockerfile for a Cloud Run move |

One language, one deployable. The decisions and the alternatives that were rejected are recorded
as ADRs in `docs/adr/`.

## Architecture notes

**Multi-tenancy is the load-bearing decision.** One codebase serves three kinds of organisation —
a personal org, a public demo org, and customer orgs — distinguished by columns, not by
deployment.

- `org_id` on every domain table, leading every index
- Non-sequential identifiers, so portfolio size is not enumerable
- Org context resolved **server-side from the session only**, never from a client-supplied
  parameter, header or body
- `getOrgContext()` returns a scoped `db.forOrg(orgId)`; importing the raw database client is
  blocked by an ESLint rule, so the scoping is enforced rather than merely encouraged
- Postgres row-level security as an independent second layer
- A cross-org isolation integration test, extended per table

**Money is stored as integer cents.** Dates, identifiers and the estimated-versus-audited
confidence model follow the conventions in
[ADR-0005](https://github.com/hbouwers/capexwise/issues/8).

**The tax surface is the highest-risk code in the product.** Wrong numbers on a tax page are
worse than no tax page, so every figure has to be traceable to its inputs, and the disclaimer —
a planning aid, not tax advice — is a requirement rather than a nicety.

## Documentation

The repository is the source of truth.

| Path | What it holds |
| --- | --- |
| `docs/PRD.md` | Product requirements: problem, users, features, release plan, risks |
| `docs/adr/` | Architecture decision records |
| `docs/data-model.md` | Schema, indexes, deletion behaviour |
| `docs/ui/tokens.md` | Design tokens |
| `docs/ui/components.md` | Component inventory |
| `docs/ui/screens/` | One spec per screen |
| `docs/ui/reference/` | The design prototype, as the visual source of truth |
| `CLAUDE.md` | Conventions and hard rules, indexing the above |

## Releases

| | Contents | Done when |
| --- | --- | --- |
| **v0** | Portfolio dashboard, buildings and units, capital items, CapEx forecast, maintenance, contacts, auth and orgs | Two real duplexes and four units are fully entered, rent is tracked monthly, and the forecast is trusted enough to act on |
| **v0.5** | Seeded demo org, public URL, public repository | A visitor can understand the product in ninety seconds |
| **v1** | Tax planner, Stripe billing, onboarding | The first outside org completes setup unassisted |
| **v2** | Quote requests, AI advisor | — |

## Local development

**Prerequisites.** Node 24, pinned in [`.nvmrc`](./.nvmrc), so `nvm use` picks it up. Docker
Desktop is needed for the database only — on Windows, install it with the WSL2 backend rather
than the Hyper-V one, because Postgres on the Hyper-V backend pays a filesystem penalty that
makes it noticeably slower.

```bash
npm install
npm run dev
```

That serves a placeholder page on `http://localhost:3000`, and the design system on
`http://localhost:3000/styleguide` — every design token and every state of every installed
primitive on one page, so that a value drifting away from
[`docs/ui/tokens.md`](docs/ui/tokens.md) is visible rather than discovered on a screen later.

**No environment variables are read yet, and `npm run dev` does not need the database** — nothing
in the application connects to it so far. Skip the next section entirely if you only want the app
running.

### The database

Postgres 18 in a container, via [`docker-compose.yml`](./docker-compose.yml):

```bash
npm run db:up
```

`db:up` waits for Postgres to actually accept connections rather than returning as soon as the
container starts, so it is safe to run a migration on the next line. The connection string, once
something reads one, is:

```
postgresql://capexwise:capexwise_local_dev@127.0.0.1:5432/capexwise
```

Those credentials are committed in the compose file on purpose. They guard a database that holds
no real data and is published to loopback only — the file explains why that is the safe
combination, and why the password must not be reused anywhere reachable off the machine.

Data lives in the named volume `capexwise-pgdata` and survives `db:down` and a machine restart.
`db:reset` deletes that volume and recreates it empty, which is the way to start clean.

**The major version is pinned to 18 and that is load-bearing.** [ADR-0005](docs/adr/0005-identifiers-money-dates.md)
makes `uuidv7()` the primary key default, and it is a Postgres 18 built-in — so the managed
instance in [#33](https://github.com/hbouwers/capexwise/issues/33) has to be 18 or newer too, and
a provider that lags on majors is disqualified.

| Script | What it does |
| --- | --- |
| `npm run db:up` | Start Postgres, waiting until it accepts connections |
| `npm run db:down` | Stop it, keeping the data |
| `npm run db:reset` | **Destroys the data** — removes the volume and starts empty |
| `npm run db:psql` | A `psql` shell in the container, so none is needed on the host |

Migrations and the demo seed are not part of this yet: `db:reset` leaves an empty database, and
the full clone → install → up → migrate → seed → dev walkthrough lands with Drizzle in
[#17](https://github.com/hbouwers/capexwise/issues/17) and the seed framework in
[#34](https://github.com/hbouwers/capexwise/issues/34). The environment template and boot-time
validation are [#20](https://github.com/hbouwers/capexwise/issues/20).

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve a production build |
| `npm run lint` | ESLint |
| `npm run format` | Prettier, writing in place |
| `npm run format:check` | Prettier, checking only — what CI asks |
| `npm run typecheck` | Generate route types, then `tsc --noEmit` |

## Licence

All rights reserved. See [LICENSE](./LICENSE). The source is published for reference and
evaluation; it is not open source.
