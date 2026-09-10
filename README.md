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
- Postgres row-level security as an independent second layer: every scoped transaction runs as a
  role the policies apply to, whatever the connection logged in as
  ([ADR-0007](docs/adr/0007-database-roles.md))
- A cross-org isolation integration test, extended per table

**Sign-in is Google OAuth and nothing else, through Better Auth**
([ADR-0004](docs/adr/0004-auth-provider.md)). No passwords, therefore no password reset and no
email provider to own; the organizations and memberships live in our own Postgres, which is what
keeps a single source of truth under the tenancy boundary rather than a mirror kept in step by
webhooks. Signing in for the first time creates the account's organization and an owner membership
in one transaction.

Two functions ask about the signed-in user, and `src/server/session.ts` is where they are
documented:

```ts
const { user } = await requireSession();   // must not render to a stranger — redirects
const session = await getSession();        // renders either way — the sign-in page
```

Neither is authorisation and neither hands back a database handle. They answer *who is this*; the
org that person is acting in is `getOrgContext()`, which re-checks the session's active org against
`memberships` on every request. There is deliberately **no middleware auth check**: middleware sees
a cookie, not a validated session, so a redirect there is tidiness rather than a boundary.

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
| `CONTRIBUTING.md` | Branch, commit and pull request conventions, and the protection to turn on at v0.5 |
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
cp .env.example .env.local   # then fill it in — see below
npm run dev
```

That serves the sign-in page on `http://localhost:3000`, and the design system on
`http://localhost:3000/styleguide` — every design token and every state of every installed
primitive on one page, so that a value drifting away from
[`docs/ui/tokens.md`](docs/ui/tokens.md) is visible rather than discovered on a screen later. The
styleguide is deliberately not behind sign-in; everything else is.

**The copy is not enough on its own any more.** `.env.example` leaves the auth variables blank
because a committed placeholder is a value somebody keeps, so filling them in is part of setup:
generate a `BETTER_AUTH_SECRET` and an `ACCESS_CODE_KEYS`, and create a Google OAuth client.
"Environment variables" below has all three, and the server names whichever one is missing rather
than starting without it.

**`npm run dev` still does not need the database running** to serve the sign-in page. It does need
it to sign in — that is the first thing in the application that writes a row.

### Environment variables

[`.env.example`](./.env.example) is the copyable list, and `src/lib/env-schema.mts` is the schema it
mirrors. A variable added to one and not the other is half a change.

**Validation runs at boot, not at first use.** `src/instrumentation.ts` is the hook Next.js calls
once before a server instance serves anything; through `src/server/boot.ts` it imports
`src/server/env.ts`, which parses `process.env` against the schema. A missing or malformed value
prints what is wrong with which variable and exits non-zero:

```
Invalid environment configuration:

  DATABASE_URL is not set

Set it in the environment the process runs in — locally by copying `.env.example` to `.env.local`,
on a deploy through the platform's own environment configuration. `.env.example` lists every
variable, and the README says where each value comes from in each environment.
```

**No value is ever printed** — only variable names and what is wrong with them. `DATABASE_URL`
carries a password, this message lands in deploy logs, and deploy logs are retained and widely
readable. It is the rule the migration runner already follows when it logs the host and database it
is about to migrate and never the connection string it read them from.

`next build` is deliberately not covered, and that costs something to keep. The Dockerfile builds
with no environment at all — not `DATABASE_URL`, not the auth secret, not the Google client —
because [ADR-0006](docs/adr/0006-migrations.md) keeps the database out of the build and
[ADR-0002](docs/adr/0002-hosting.md) wants an image that is the same artefact wherever it runs.
Configuration is a deploy-time concern, so it is checked at deploy time. The way that stays true is
that `src/server/env.ts`, `src/db/client.ts` and `src/server/auth.ts` all read on **first use**
rather than on import: `next build` imports every route module to collect its configuration, and a
parse at module scope would quietly make the build demand production secrets. CI runs the build
with an empty environment for exactly this reason.

**Server and public variables are separate halves of the file, and the separation is structural.**
`src/server/env.ts` imports `server-only`, so a Client Component that reaches for it fails the
build. A `NEXT_PUBLIC_` variable is the opposite of that: the compiler inlines its value into the
client bundle as a literal, so it is published to every browser and stays published in every cached
build — a secret that acquires the prefix cannot be un-published by removing it. The schema refuses
to start the server if a server variable carries the prefix. There are no public variables yet.

| Variable | Local | Preview | Production |
| --- | --- | --- | --- |
| `DATABASE_URL` | `.env.local`, pointing at the compose database | Written by the Neon integration for each preview deployment — a branch of its own, separate from production's, settled in [#33](https://github.com/hbouwers/capexwise/issues/33) | Vercel project environment, Production scope, **set by hand and Sensitive** — not the integration's: the managed instance's pooled endpoint, logged in as `capexwise_app` ([#33](https://github.com/hbouwers/capexwise/issues/33), [#81](https://github.com/hbouwers/capexwise/issues/81)) |
| `APP_URL` | `http://localhost:3000` | **Per deployment.** A preview hostname is generated, so this cannot be set once at the project level ([#32](https://github.com/hbouwers/capexwise/issues/32)) | `https://capexwise.com` |
| `BETTER_AUTH_SECRET` | Generated once, per machine — never copied from anywhere | Vercel project environment, Preview scope; its own value | Vercel project environment, Production scope; its own value |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | A Google OAuth client of your own, in Testing mode | The same client as production, or its own | The production OAuth client |
| `ACCESS_CODE_KEYS` | Generated once, per machine | Vercel project environment, Preview scope; its own value, never production's | Vercel project environment, Production scope, **Sensitive**, with a copy kept outside Vercel ([ADR-0008](docs/adr/0008-access-code-encryption.md)) |

#### The database

Managed Postgres is **Neon**, on AWS `us-east-1` (Washington, D.C.), reached through the Vercel
marketplace integration so that the Vercel project and the database branches are wired together
(#33). Local development does not use it at all — that is the compose container, and the two never
talk.

One Neon project, with a branch per environment: `main`, the project's default branch, backs the
live Vercel deployment, and each preview deployment gets a branch named `preview/<git branch>`,
created from `main` and so holding a copy of production's rows. "Production" here means the deployment that holds real
data rather than the plan it runs on — through v0 and v0.5 that is the Vercel Hobby instance with
the real portfolio in it, and at v1 the role moves to Cloud Run with [ADR-0002](docs/adr/0002-hosting.md)'s
migration. The secret the migrate job reads follows the role, not the vendor, which is why it is
named `PRODUCTION_DATABASE_URL` and why that move is a change of value rather than a change to
[`ci.yml`](.github/workflows/ci.yml).

The free plan is 0.5 GB of storage, 100 CU-hours, 10 branches and 5 GB of egress per project per
month, and the compute scales to zero after five minutes idle, which cannot be turned off. Two of
those bite long before storage does, and neither is about how much data there is:

- **CU-hours.** 100 is about 400 hours at 0.25 CU, against roughly 730 in a month, which is
  comfortable while the compute sleeps between sessions. At v0.5 the demo is a public URL, and
  anything that polls it steadily keeps the compute awake. Exhausting the budget suspends the compute
  **until the next billing period** — so the failure mode is the portfolio demo being dead when
  somebody clicks the link, which is the one thing v0.5 exists to avoid.
- **The ten-branch cap.** A branch per pull request plus `main` reaches ten quickly, and the
  integration does not delete them when a pull request closes. It deletes a preview branch only
  when Vercel deletes the last deployment for that git branch, and Vercel keeps preview deployments
  for months and always keeps the project's last ten. Branch creation then fails, and what fails
  with it is the preview, not anything loud. Until something deletes them on close (#32), delete
  merged pull requests' branches in the Neon console.

**Row-level security depends on which role `DATABASE_URL` logs in as**
([ADR-0007](docs/adr/0007-database-roles.md)), so in production the application and CI log in as
**different users, on purpose**. Vercel's `DATABASE_URL` names `capexwise_app` on the pooled
endpoint: not the owner, no `BYPASSRLS`, and holding only the two roles the policies are written
for, so the unscoped client gets `permission denied` on every domain table whatever Neon does with
the owner. CI's `PRODUCTION_DATABASE_URL` names the owner on the direct endpoint, because migrations
need DDL. Pointing Vercel at the owner would not fail loudly — the migration grants the owner the
identity role as well, so sign-in keeps working — which is exactly why the difference is written
down here.

`capexwise_app` was created with SQL on the `main` branch rather than in the Neon console,
which adds the roles it creates to Neon's own administrative group
([#81](https://github.com/hbouwers/capexwise/issues/81) has the statements).

**The Neon integration does not supply production's `DATABASE_URL`.** It connects only as the owner
and has no setting for the role, so its connection to the Vercel project covers Preview only.
Production is unticked, and so is Development, because local development uses the compose
database and never needs a Neon connection string on the machine. Production's `DATABASE_URL` is an ordinary project
variable instead, Production scope only, marked Sensitive, built from the Neon console's Connect
dialog with the role set to `capexwise_app` and pooling on. **Reconnecting the integration with
Production ticked undoes this**: at best it clashes with the variable, at worst production is
quietly back on the owner, and nothing would flag it.

Sensitive means Vercel will not show the value again, so there is nothing to read back. Rotating the
password is an `alter role` on the `main` branch, the full connection string typed into the
variable again, and a production redeploy: Vercel applies an environment change only to deployments
built after it.

Previews stay on the owner. The integration writes each preview branch's connection string itself
when the deployment is created, with no role setting to change, so a different user there would mean
overriding it on every deployment. A preview's unscoped client is then exactly as restricted as
production's was before #81 — ESLint's rule on `@/db/client` is the guard.

**Every environment needs its own `BETTER_AUTH_SECRET`.** It signs session cookies and encrypts the
OAuth tokens stored in `accounts`, so sharing one across environments means a session forged in
preview is valid in production. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**Every environment needs its own `ACCESS_CODE_KEYS` too**, for a reason specific to Neon. The
integration creates every preview branch from `main`, production's own branch, and a Neon branch
holds its parent's rows. A preview deployment holding production's key would therefore reveal every production access code from a URL that exists for code review. With its own key it
cannot open them. Version numbers restart in each environment, and preview's
version 1 is a different key from production's. Generate one with:

```bash
node -e "console.log('1:' + require('crypto').randomBytes(32).toString('base64url'))"
```

Production's is the one secret here whose loss costs data rather than a sign-in. Vercel will not
show a Sensitive value again, and every code sealed under a key that nobody holds is gone. So the
value goes into the password manager as well as into Vercel, and a key retired by a rotation stays
there for as long as any backup that needs it
([#35](https://github.com/hbouwers/capexwise/issues/35)). [ADR-0008](docs/adr/0008-access-code-encryption.md)
has the rotation.

`npm run db:migrate` validates a strict subset — `DATABASE_URL` and nothing else — so the CI job
that applies migrations on a push to `main` never needs an auth secret or a Stripe key to run one.
That job reads the production string from a secret named `PRODUCTION_DATABASE_URL` rather than from
the table above, because nothing in this table belongs to CI: these are the variables the
*application* reads, and "Applying migrations" below is where the credential CI holds is described.

#### The Google OAuth client

[ADR-0004](docs/adr/0004-auth-provider.md) makes Google the only way to sign in during v0, so the
application will not start without a client. Creating one, in the Google Cloud console:

1. **APIs & Services → OAuth consent screen.** External, and leave it in **Testing** while the app
   is personal — a Testing app needs no verification and works for up to 100 accounts. Add every
   Google account that needs in as a **test user**, including your own.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.**
3. **Authorised redirect URIs:** one per environment, each of them that environment's `APP_URL`
   plus `/api/auth/callback/google`. For local development that is
   `http://localhost:3000/api/auth/callback/google` — and `http://localhost:3001/...` as well if
   you sign in through `npm run docker:up`.
4. Copy the client id and secret into `.env.local`.

No scopes beyond the default profile and email are requested, and none should be: the product has
no business reading anybody's Google data.

### The database

Postgres 18 in a container, via [`docker-compose.yml`](./docker-compose.yml):

```bash
npm run db:up
npm run db:migrate
```

`db:up` waits for Postgres to actually accept connections rather than returning as soon as the
container starts, so `db:migrate` on the next line is safe. That is the whole database setup —
clone, `npm install`, the copy, those two lines, `npm run dev`. Signing in additionally needs a
Google OAuth client, which "Environment variables" above covers.

`.env.local` is gitignored and [`.env.example`](./.env.example) is the committed template. Its
`DATABASE_URL` is the value the compose file configures, so that line works unedited; the auth
variables above it do not, and "Environment variables" is where they come from:

```
postgresql://capexwise:capexwise_local_dev@127.0.0.1:5432/capexwise
```

Those credentials are committed in the compose file on purpose. They guard a database that holds no
real data and is published to loopback only — the file explains why that is the safe combination,
and why the password must not be reused anywhere reachable off the machine.

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
| `DATABASE_URL` | **At startup** | none | The container validates it and exits non-zero without it, so a misconfigured deploy fails immediately rather than on the first query. Not needed at *build* time, and deliberately so — [ADR-0006](docs/adr/0006-migrations.md) keeps the database out of the build |
| `PORT` | No | `3000` | Cloud Run injects its own, so the server reads it rather than hardcoding one |
| `HOSTNAME` | No | `0.0.0.0` | Load-bearing. The standalone server binds `127.0.0.1` otherwise, which inside a container means nothing can reach it and the failure reads like the app never started |
| `NODE_ENV` | No | `production` | Set in the image; nothing should need to override it |

Anything added to [`.env.example`](./.env.example) that the server reads at runtime is passed to the
container the same way — as environment, at deploy. "Environment variables" above is where each
value's per-environment home is recorded.

**The container does not run migrations**, at boot or otherwise. They run in CI on a push to
`main`, for the reasons in [ADR-0006](docs/adr/0006-migrations.md).

Three things about the image are worth knowing before changing it. It is built from
`output: "standalone"`, so it ships the server and the modules Next traced as reachable rather than
all of `node_modules` — a dependency loaded by a path that cannot be traced statically works under
`npm start` and is missing here, which is why CI starts the container instead of only building it.
It runs as the unprivileged `node` user. And its base image is pinned by digest as well as by tag,
so a build that passed last week and fails today has changed for a reason visible in the diff.

### Tests

Three suites, split by what they need rather than by what they cover. The cheapest one needs
nothing and runs in under a second, which is the point: anything that can be a unit test is one.

```bash
npm test
```

That is the unit suite — pure functions, no database, no server, no network. `npm run test:watch`
is the same thing left running.

```bash
npm run db:up
npm run test:integration
```

The integration suite runs against **its own database**, `capexwise_test`, which it creates and
migrates on first run and truncates between every test. It never touches the `capexwise` database
`npm run dev` uses, and it refuses outright to run against any database whose name does not end in
`_test` — so a `TEST_DATABASE_URL` copied from the wrong line fails loudly instead of emptying
something. Leave that variable unset unless you want a different server; the default is the compose
database.

What belongs here is the part of the schema that lives in SQL: defaults, triggers, partial indexes,
constraints, and — from #27 onward — cross-org isolation. Those are claims `npm run typecheck`
cannot check.

```bash
npm run test:e2e
```

The end-to-end suite, one Chromium browser against a dev server Playwright starts on port 3100.
It covers the failures that need a real browser to see: a route that 500s, a stylesheet that never
arrives, a font that silently falls back. It is deliberately small — the container job in CI already
proves the production image boots and serves, and everything else is faster to assert in Vitest.
The browser is not installed with the dependencies; `npx playwright install chromium` gets it.

All three run on every pull request, in the pipeline below. The coverage stance — what gets real
tests and what deliberately does not — is in [CLAUDE.md](./CLAUDE.md) under "Testing".

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve a production build |
| `npm test` | Unit tests. Needs nothing |
| `npm run test:watch` | Unit tests, left running |
| `npm run test:integration` | Database-backed tests. Needs `npm run db:up` |
| `npm run test:e2e` | Playwright, against a dev server it starts |
| `npm run lint` | ESLint |
| `npm run format` | Prettier, writing in place |
| `npm run format:check` | Prettier, checking only — what CI asks |
| `npm run typecheck` | Generate route types, then `tsc --noEmit` |

## Continuous integration

One workflow gates a merge: [`.github/workflows/ci.yml`](.github/workflows/ci.yml), on every pull
request and on every push to `main`. Four jobs, in parallel, split by what they need rather than
by what they cover — the same rule the test suites are split by.

| Job | Needs | What it runs |
| --- | --- | --- |
| Types, lint and schema | nothing | `format:check`, `lint`, `typecheck`, `db:drift` |
| Production build | nothing | `next build`, with no `DATABASE_URL` |
| Unit, integration and end-to-end | a Postgres 18 service | the three suites, against a Postgres service container |
| Build and run the image | Docker | `docker build`, then start the container and check it serves a page and its stylesheet as a non-root user |

Each job pays its own checkout and `npm ci`; with the npm cache warm that costs less than
serialising them would. None of the four needs a secret — the Postgres credential is the committed
local one, and the `DATABASE_URL` the container job passes points at nothing on purpose.

### Applying migrations

A fifth job, **Apply migrations to production**, is not part of that gate. It runs only on a push
to `main`, waits for the two jobs that can tell a migration is wrong before it is applied — the
drift check and the integration suite — and then runs `npm run db:migrate` against production. This
is the operational half of [ADR-0006](docs/adr/0006-migrations.md): migrations are applied by CI, on
`main`, never in a build, never by the application at boot, never from a laptop.

It takes the connection string from a secret named `PRODUCTION_DATABASE_URL`, and hands it to the
runner as `DATABASE_URL`, which is the only variable `npm run db:migrate` validates. The two names
are kept apart deliberately: there is no secret called `DATABASE_URL`, so no future job can pick one
up and point at production by accident. This is the only real credential in the workflow.

**The secret belongs to a GitHub environment named `production`, not to the repository**, and the
job declares `environment: production` to reach it. The distinction is the difference between where
the credential may be *used* and where it may be *read*. A repository secret — Settings → Secrets
and variables → Actions — is readable by every run in the repository, and the workflow a run
executes is the one from its own head commit, so a branch that adds a step echoing the value has it
printed on the pull request run before anyone reviews the workflow change. An environment secret is
readable only by a job that names the environment, and the environment carries a deployment branch
rule for `main`. That is cheap while the repository is private and load-bearing at v0.5, when it and
its retained logs go public.

Setting it up, once: Settings → Environments → **New environment** named `production`, add
`PRODUCTION_DATABASE_URL` under **Environment secrets**, add a deployment branch rule limiting it to
`main`, and delete any repository-level copy of the same secret.

**That secret holds Neon's direct endpoint, not the pooled one** — the host without `-pooler` in it.
The two are different values for the same database and the split is deliberate: the pooled endpoint
is pgbouncer in transaction mode, which lends a connection out for one transaction and then hands it
to someone else. That is what the application wants and what migrations do not — DDL and the
migrator's bookkeeping want a real session. So the application's `DATABASE_URL` in Vercel is the
pooled endpoint, and this job's is the direct one.

Transaction-mode pooling is also why `app.current_org_id` is applied with `SET LOCAL` inside a
transaction rather than session-level, which
[ADR-0003](docs/adr/0003-multi-tenancy.md) requires and
[`org-context.ts`](src/server/org-context.ts) implements. A session-level setting would outlive the
request and be inherited by whoever got that pooled connection next, which is a cross-tenant read.

It has its own concurrency group, `migrate-production`, with `cancel-in-progress: false`, so two
pushes migrate one after another rather than at once — and the workflow-level group cancels
superseded runs on pull requests only, because a cancel on `main` would arrive part-way through
someone's DDL.

Nothing checks that the secret is present. A missing `PRODUCTION_DATABASE_URL` fails the migration
runner's environment validation and turns the run red, which is the right outcome for a release that
would otherwise have quietly migrated nothing.

Vercel builds every pull request too, and that check is not this workflow. It is the deploy
preview, it builds without `output: "standalone"` ([#68](https://github.com/hbouwers/capexwise/issues/68)),
and it goes away with the move to Cloud Run — which is exactly why the container job exists.

[`.github/workflows/codeql.yml`](.github/workflows/codeql.yml) is the one other workflow, and it
is not part of that gate — it reports to the Security tab. Code scanning needs GitHub Advanced
Security on a private repository and is free on a public one, so the job guards itself on
repository visibility: it skips on every run today and starts analysing by itself on the commit
that makes the repository public at v0.5. [`CONTRIBUTING.md`](./CONTRIBUTING.md) lists what else
to switch on at that point, including the branch protection the current plan does not offer.

## Licence

All rights reserved. See [LICENSE](./LICENSE). The source is published for reference and
evaluation; it is not open source.
