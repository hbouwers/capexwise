# ADR-0001: Stack

**Status:** Proposed — accepted on merge of the PR that adds it
**Date:** 2026-09-08
**Decided by:** Holden

## Context

This is written after the fact. The stack was chosen at the start of the project and the repo
already assumes it; the point of recording it now is that "why not .NET" and "why not Prisma" are
questions that will be asked again, and answering them from memory in six months is how a
considered decision turns into an accident.

The constraint that decides almost everything here is that **one person builds, operates, and
maintains this**, across three audiences at once: a personal tool that has to actually work, a
public portfolio artifact, and eventually a paid product. Anything that doubles — two languages,
two runtimes, two deployment pipelines, two dependency graphs to patch — is paid for weekly by one
person, forever.

Two other forces matter. The forecast and tax maths are the product, so they need real unit tests
and benefit from types shared with the UI that renders them. And ADR-0003 makes org scoping a
server-side-only rule, which is much easier to hold if the default data path is already on the
server.

## Decision

**Next.js (App Router) with TypeScript, Postgres, Drizzle, and Tailwind with shadcn/ui.**

- **Next.js 16, App Router.** `latest` on npm is 16.3.4 as of 2026-08-31.
- **TypeScript everywhere**, including the forecast and tax modules, which are plain TypeScript
  with no framework coupling so they can be unit-tested directly.
- **Postgres**, plain, with no vendor-specific extensions in the schema.
- **Drizzle** for schema, queries and migrations, with the schema in TypeScript as the source of
  truth and generated SQL migrations checked in.
- **Tailwind and shadcn/ui**, with tokens extracted from the design prototype (#10) rather than
  invented.
- **Server Components are the default data path.** Client components are the exception and are
  chosen deliberately.

That last point is not a style preference. In ADR-0003 the org id is resolved server-side from the
session and never accepted from the client. If the default way to fetch data is a server component
calling `db.forOrg(orgId)`, that rule is structural: there is no client-side data layer for a
client-supplied org id to enter through. A client-fetch-by-default architecture would make the
same rule a discipline instead.

### Drizzle version line

Start on the **stable 0.45.x line**, not the 1.0 prereleases. `latest` is 0.45.2, published
2026-03-27. Drizzle 1.0 has been in prerelease since 2025-03-13 — 318 prerelease versions, most
recently `1.0.0-rc.5` on 2026-08-12 — and has not shipped. RLS support, which ADR-0003 depends on,
landed in 0.36.0 with `pgPolicy` and `.enableRLS()`, so the stable line does what we need.

Take 1.0 deliberately, before there is customer data, rather than drifting onto it. Pin exact
versions and do not float (#17).

## Alternatives considered

**A Next.js frontend with a .NET API.** The most seriously considered alternative, and it loses on
the doubling. Two languages, two test suites, two CI pipelines, two dependency-update streams, and
two deployment targets, for one developer. It also weakens the thing ADR-0003 cares most about:
`getOrgContext()` and the scoped `db.forOrg()` would either exist twice or become an HTTP boundary
with the org id travelling across it — and an org id in transit is an org id that can be tampered
with. The single-runtime version makes the tenancy rule enforceable by an ESLint rule (#16), which
the split version cannot be.

**Angular with a Python backend** — the stack from the career-plan project, and therefore the
familiar option. Rejected for the same doubling, plus no server-component story, which means the
data path starts on the client and the ADR-0003 rule becomes a habit rather than a structure.

**Prisma instead of Drizzle.** A real contender with better ergonomics in places. It loses on two
things specific to this project: a heavier runtime and generated-client step in a serverless
deployment (ADR-0002), and a schema DSL that sits further from SQL exactly where we need to be
close to it — RLS policies, partial and composite indexes, and the `org_id`-leading index rule.
Drizzle's schema is TypeScript that maps onto SQL nearly one-to-one, which matters when the
security model is expressed in SQL.

**Kysely, or raw SQL with a query builder.** Excellent at queries, but leaves schema management and
migrations to be assembled from other pieces. For a solo project the integrated migration story is
worth more than the marginal query ergonomics.

**Rails or Django.** Genuinely strong single-language answers with better batteries. Rejected
because the shared TypeScript types between the forecast maths and the UI that renders them are a
real benefit here, and because the design handoff (#10, #11) targets a React component library.

## Consequences

**What this makes easy.** One language end to end, so the `Money` type and the forecast's return
shapes are the same objects in the maths, the API and the UI. One deployable and one dependency
graph to patch. Server Components make the ADR-0003 scoping rule structural rather than
aspirational. Drizzle keeps migrations as reviewable SQL in the repo, which is what lets #27 and
#28 test the security model rather than trust it.

**What this makes hard.** Next.js major upgrades are the largest recurring maintenance event this
codebase will have, and the App Router's data-fetching and caching semantics have moved
meaningfully between majors before. **Drizzle is the live risk**: the stable line has not had a
release since 2026-03-27 while 1.0 accumulates release candidates, so we are betting on a 0.x that
is quiet rather than abandoned, and the 1.0 migration will land during v0 or v1 development. The
mitigation is the same as ADR-0004's: pin exact versions, watch releases deliberately, and treat
the major as a scheduled piece of work rather than a surprise.

**Cost of reversal.** Uneven, and worth being specific about. Swapping Tailwind or shadcn is
cosmetic. Swapping Drizzle for another Postgres tool is a real but bounded project, because the
schema is SQL underneath and the migrations are checked in — the queries move, the data does not.
Swapping Next.js is effectively a rewrite of everything above the maths modules, which is exactly
why the forecast and tax code is kept as plain TypeScript with no framework imports. Those modules
are the part worth protecting, and they are portable by construction.

## Sources

- npm registry, `next` and `drizzle-orm` dist-tags and publish dates — checked 2026-09-08
- [Drizzle RLS documentation](https://orm.drizzle.team/docs/rls) and the
  [0.36.0 release](https://github.com/drizzle-team/drizzle-orm/releases/tag/0.36.0), which
  introduced `pgPolicy`
