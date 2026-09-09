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
Desktop for the database, and for building the application container — on Windows take the WSL2
backend, which is the current default; the Hyper-V one is legacy and is not what this is run
against.

```bash
npm install
npm run dev
```

That serves a placeholder page on `http://localhost:3000`, and the design system on
`http://localhost:3000/styleguide` — every design token and every state of every installed
primitive on one page, so that a value drifting away from
[`docs/ui/tokens.md`](docs/ui/tokens.md) is visible rather than discovered on a screen later.

**`npm run dev` does not need the database yet** — nothing in the application connects to it so
far, and `DATABASE_URL` is read only by the migration tooling. Skip the next two sections entirely
if you only want the app running.

### The database

Postgres 18 in a container, via [`docker-compose.yml`](./docker-compose.yml):

```bash
cp .env.example .env.local
npm run db:up
npm run db:migrate
```

`db:up` waits for Postgres to actually accept connections rather than returning as soon as the
container starts, so `db:migrate` on the next line is safe. That is the whole setup — clone,
`npm install`, those three lines, `npm run dev`.

`.env.local` is gitignored and [`.env.example`](./.env.example) holds one variable, `DATABASE_URL`,
because that is all anything reads today:

```
postgresql://capexwise:capexwise_local_dev@127.0.0.1:5432/capexwise
```

Those credentials are committed in the compose file on purpose. They guard a database that holds no
real data and is published to loopback only — the file explains why that is the safe combination,
and why the password must not be reused anywhere reachable off the machine. The full variable list
and boot-time validation, so a missing value fails at start rather than on the first query, are
[#20](https://github.com/hbouwers/capexwise/issues/20).

Data lives in the named volume `capexwise-pgdata` and survives `db:down` and a machine restart.
`db:reset` deletes that volume and recreates it empty, so a clean slate is `db:reset` followed by
`db:migrate`.

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

### Schema changes

The Drizzle schema in `src/db/schema/` is the source of truth, and `docs/data-model.md` is the prose
version of it. A change to one without the other is a bug in whichever was changed alone.

```bash
npm run db:generate -- --name what_it_does
```

That writes SQL to `drizzle/`. **Read it before committing it** — migrations are forward-only, so
there is no `down` to fall back on and review of the SQL is what stands in for one. Then
`npm run db:migrate` to apply it locally, and commit the generated file alongside the schema change.
`npm run db:drift` is the check CI runs: it fails if the schema is ahead of the committed
migrations, which is otherwise invisible in review — the types are right, the queries compile, and
the column exists in no database.

Triggers and functions are hand-written, because Drizzle does not model them —
`npm run db:generate -- --custom --name what_it_does` prepares an empty migration to write SQL into.
`drizzle/0001_updated_at_trigger.sql` is the example to copy.

**How migrations reach production, and why there is no rollback**, is
[ADR-0006](docs/adr/0006-migrations.md): they run in CI on `main`, never in the Vercel build, and
every migration has to be compatible with the release already running. Read it before writing a
migration that drops anything.

| Script | What it does |
| --- | --- |
| `npm run db:generate` | Generate a migration from the schema. Takes `-- --name a_description` |
| `npm run db:migrate` | Apply committed migrations. Needs `DATABASE_URL` |
| `npm run db:drift` | Fail if the schema is ahead of the committed migrations |
| `npm run db:studio` | Drizzle Studio, a browser UI over the data |

The demo seed is [#34](https://github.com/hbouwers/capexwise/issues/34), so `db:migrate` leaves a
schema with no rows in it.

### The container

[`Dockerfile`](./Dockerfile) is the escape hatch from [ADR-0002](docs/adr/0002-hosting.md), and it
is maintained from commit one rather than written when it is needed. Vercel Hobby forbids
commercial use, so Stripe going live at v1 forces a move to Cloud Run — and whether that is an
afternoon or a quarter comes down to whether the image has been built and run recently. CI builds
it and starts it on every pull request for that reason.

```bash
npm run docker:up
```

That builds the image and starts it against the compose database, on
`http://localhost:3001` — 3001 rather than 3000 so it and `npm run dev` can be up together.
`npm run docker:down` stops it. The app service sits behind a Compose profile, so
`npm run db:up` is unaffected and starts Postgres alone.

| Script | What it does |
| --- | --- |
| `npm run docker:build` | Build the image only |
| `npm run docker:up` | Build and start it, plus the database, waiting until both are healthy |
| `npm run docker:down` | Stop both, keeping the data |

**Configuration comes from the environment, never from a baked-in value.** That is the property
that makes the Cloud Run move a config exercise instead of a rebuild, so `.env*` is in
[`.dockerignore`](./.dockerignore) deliberately.

| Variable | Needed | Default in the image | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | At runtime, once anything reads it | none | Not needed at build time, and deliberately so — [ADR-0006](docs/adr/0006-migrations.md) keeps the database out of the build. Nothing in the application connects yet; [#20](https://github.com/hbouwers/capexwise/issues/20) makes a missing value a startup error |
| `PORT` | No | `3000` | Cloud Run injects its own, so the server reads it rather than hardcoding one |
| `HOSTNAME` | No | `0.0.0.0` | Load-bearing. The standalone server binds `127.0.0.1` otherwise, which inside a container means nothing can reach it and the failure reads like the app never started |
| `NODE_ENV` | No | `production` | Set in the image; nothing should need to override it |

The list grows with [#20](https://github.com/hbouwers/capexwise/issues/20), which is where every
variable and its per-environment home are recorded. Anything added there that the server reads at
runtime is passed to the container the same way — as environment, at deploy.

**The container does not run migrations**, at boot or otherwise. They run in CI on a push to
`main`, for the reasons in [ADR-0006](docs/adr/0006-migrations.md).

Three things about the image are worth knowing before changing it. It is built from
`output: "standalone"`, so it ships the server and the modules Next traced as reachable rather than
all of `node_modules` — a dependency loaded by a path that cannot be traced statically works under
`npm start` and is missing here, which is why CI starts the container instead of only building it.
It runs as the unprivileged `node` user. And its base image is pinned by digest as well as by tag,
so a build that passed last week and fails today has changed for a reason visible in the diff.

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
