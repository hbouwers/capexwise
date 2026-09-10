# ADR-0003: Multi-tenancy

**Status:** Proposed — accepted on merge of the PR that adds it
**Date:** 2026-09-08
**Decided by:** Holden

## Context

One codebase serves three kinds of organization: Holden's personal org, a public demo org that
resets nightly, and customer orgs. The PRD is explicit that these are not three products, and
ADR-0002 keeps hosting on Vercel with Cloud Run as an escape hatch, so there is no second
deployment to hide a tenant behind and there will not be one.

That makes the tenancy boundary the highest-consequence decision in the system. Everything else
here fails as a bug. This fails as one landlord reading another landlord's portfolio — addresses,
access codes, and enough financial detail to be worth having.

Four things are already fixed and constrain the answer:

1. **ADR-0001** put us on plain Postgres with Drizzle. There is no ORM-level tenancy magic to lean
   on, and no vendor isolation primitive either.
2. **ADR-0004** put organizations and memberships in our own Postgres, authoritative, rather than
   in an identity vendor. Membership is therefore a join we can make inside the same transaction
   as the query it authorises — which is what makes the design below possible at all.
3. **ADR-0002** means serverless request handlers against a pooled connection. Connection reuse
   across requests is the default rather than an edge case, and #33 has not yet chosen the pooling
   mode.
4. **Goal 2** is that this repo generates technical discussion about multi-tenancy. A design that
   hides the boundary is worth less here than one that shows it, all else equal — though not at
   the cost of being weaker.

One clarification, because #48 introduced a second scoping column and the two get confused:
`unit_id` on `capital_items` and `tasks` is **not** a tenancy boundary. It is a scope *within* an
org — is this the building's roof, or unit B's dishwasher. Only `org_id` is a security boundary,
and nothing in this ADR applies to `unit_id`.

## Decision

**One database, one schema, `org_id` as a discriminator column, defended twice.**

- **`org_id` on every domain table, leading every index.** On the row, not a join away through a
  parent table. A query that filters by `org_id` should never need a join to prove it is safe, and
  an index that does not lead with `org_id` invites a plan that reads another tenant's rows before
  discarding them.
- **The three org kinds are columns, not deployments.** `organizations.is_demo` and
  `organizations.plan` distinguish them. The demo org is a row, seeded and reset in SQL (#34).
- **Org context is resolved server-side from the session, and only from the session.** Never a
  route param, a header, or a request body. A client-supplied org id is **ignored, not
  validated** — validating it invites a code path where an id from the wrong place is used because
  it looked correct.
- **`getOrgContext()` re-checks membership on every request** against our own `memberships` table,
  then returns a scoped `db.forOrg(orgId)`. Per ADR-0004, the session's active org is a hint about
  what the user is asking for; the join is what decides whether they may have it.
- **Importing the raw database client is blocked by an ESLint rule** (#16). The scoped handle is
  the only way to reach the database from application code.
- **Postgres row-level security is an independent second layer** (#28), in place before the first
  paying customer rather than after.
- **A cross-org isolation integration test, extended per table** (#27). Any migration that adds a
  table extends it, and that is a line on the PR checklist (#23) rather than a habit.

### The two layers have to fail independently

Application scoping is what a developer sees and reasons about. RLS is what catches the query
where they did not. That only works if RLS cannot be defeated by the same mistake that defeats the
scoped handle, which makes three implementation details load-bearing rather than incidental:

- **The application connects as a role that is subject to RLS.** Postgres exempts a table's owner
  from its own policies by default, so migrations run as the owner, the application runs as a
  separate restricted role, and the tables carry `FORCE ROW LEVEL SECURITY`. Skipping this is the
  failure where RLS is enabled, reports itself as enabled, and does nothing.
- **`app.current_org_id` is set per transaction with `SET LOCAL`,** never as a session-level
  `SET`. Under transaction-mode pooling a session-level setting outlives the request and is
  inherited by whichever request gets that connection next — the exact breach this layer exists to
  prevent. This constrains #33: whatever pooling mode is chosen has to keep `SET LOCAL`
  transaction-scoped.
- **Policies fail closed, and the helper makes the failure loud.**
  `current_setting('app.current_org_id', true)` returns null rather than raising when the setting
  is missing, so a policy comparing against it filters everything out. That is safe but silent,
  and an empty result set is a poor way to learn the context was never set. `db.forOrg()` asserts
  the setting took effect, so a missing context is an exception at the boundary instead of a page
  that renders zero buildings.

*[ADR-0007](0007-database-roles.md) is how #28 met the first of these — a role switch inside each
scoped transaction, rather than a second login — and which code is allowed past the policies.*

## Alternatives considered

**Database per tenant.** The strongest isolation available, and the honest reason it loses is
operational rather than architectural. Migrations fan out across N databases and a partial failure
leaves tenants on different schema versions. Serverless handlers multiply connections per tenant
against a pool that is already the binding constraint in ADR-0002. And the personal/demo/customer
split stops being a column and becomes deployment topology, contradicting the PRD's "these are not
three products". For a solo developer this is a second full-time operational surface. It is also,
notably, the thing this design can migrate *toward* later — see the reversal cost.

**Schema per tenant.** The usual middle ground, and it inherits the migration fan-out without
buying real isolation in exchange. It also depends on `search_path`, which under a pooled
connection is the same class of leak as a session-level `SET` — swapping one footgun for another
rather than removing it.

**Discriminator column with application filtering only, no RLS.** What most products in this
category actually ship, and it would work right up until it did not. One forgotten `where` clause
in one handler is a breach rather than a bug, and the defect is invisible in review precisely
because correct and incorrect code look identical. Rejected on consequence, not on likelihood.

**RLS only, with no application scoping.** Tempting, because it puts the rule in one place. But
every query then silently depends on the context having been set, mistakes surface as empty
results rather than errors, and application code loses any local evidence that it is scoped. It
also makes the legitimate cross-org paths — the nightly demo reset, migrations, future support
tooling — awkward enough that pressure to add a bypass role arrives early, which is how a second
layer stops being a second layer.

**Separate deployments per org kind.** Three of everything, permanently, to solve a problem two
columns solve. Contradicts the PRD directly.

## Consequences

**What this makes easy.** One migration path, one deploy, one set of dependencies. The demo org is
a row, so seeding and the nightly reset are SQL rather than orchestration (#34). Isolation is cheap
to test, because both layers are inspectable from a single test database (#27). Nothing here is
Vercel-specific or vendor-specific, so the Cloud Run escape hatch stays open. And the boundary is
legible in the repo, which is what goal 2 asked for.

**What this makes hard.** Every new table becomes a four-item checklist — `org_id`, the leading
index, an RLS policy, a case in the isolation test — and checklists decay, which is why #23 puts it
in the PR template rather than in someone's memory. Noisy-neighbour isolation is simply absent: one
org running an expensive forecast competes with every other org, and there is no per-org resource
limit in this design. Restoring a single org from backup is a selective export rather than
restoring a database, and deleting an org is a cascade across every table rather than a
`DROP DATABASE` — both worth knowing now that the repo goes public and customer data follows.
Finally, the legitimate cross-org paths — the demo reset today, support tooling later — need a
deliberate escape hatch, and that escape hatch will be the most dangerous code in the product. It
is out of scope here, but it should arrive as its own ADR rather than as a helper someone adds on a
Tuesday.

**Cost of reversal.** Low in the direction that matters. `org_id` on every row is exactly what
makes a later extraction to a dedicated database possible: one org's rows are selectable, and the
application change is connection routing rather than a data model change. That is a real project,
but it is a project, and it can be done for one demanding customer without moving anyone else. The
reverse — starting per-tenant and consolidating — means reconciling N schemas that have drifted and
inventing the `org_id` values after the fact.

The state with no recovery is a shared database *without* the discriminator, where tenant ownership
has to be inferred from joins after the fact. This ADR is mostly an argument for never being in
that state.

## Deliberately left open

- **Pooling mode** (#33). This ADR constrains it — `SET LOCAL` has to stay transaction-scoped — but
  does not choose it.
- **Noisy-neighbour controls.** No per-org rate or resource limits. Fine at the current scale, and
  it needs revisiting before it is not.
- **Support impersonation.** There is no cross-org read path today beyond the demo reset. When one
  is needed it gets its own ADR, its own role, and an audit trail (#42).
- **Identifier format** — UUIDv7 or ULID — belongs to ADR-0005 (#8). This ADR requires only that
  ids are non-sequential, so that a URL does not leak portfolio size.
