# ADR-0007: Database roles — the scoped role, the identity path, and who bypasses

**Status:** Proposed — accepted on merge of the PR that adds it
**Date:** 2026-09-10
**Decided by:** Holden

## Context

[ADR-0003](0003-multi-tenancy.md) makes Postgres row-level security the second of two independent
layers, and names the detail that decides whether it does anything: *the application connects as a
role that is subject to RLS*. Postgres lets three kinds of role past a policy — a superuser always,
a role with `BYPASSRLS` always, and a table's owner unless the table says `FORCE`. A policy that
applies to none of the roles actually running queries is enabled, reports itself as enabled, and
does nothing.

What is true of the roles today:

- **There is one connection string.** The application reads `DATABASE_URL` and nothing else, and
  so does the migration runner.
- **Locally and in CI, it logs in as the compose superuser**, which bypasses every policy there
  will ever be.
- **On Neon, it logs in as the role the Vercel integration created**, which owns the tables — the
  same role behind the direct endpoint CI migrates through and the pooled endpoint Vercel serves
  from (#33). Whether that role also has `BYPASSRLS` is a provider detail, and a design that works
  only if the answer is one way is a design that breaks when the provider changes it.
- **Vercel reaches Neon through pgbouncer in transaction mode.** Anything that has to hold for the
  length of a request has to be transaction-scoped, or it is inherited by whichever request gets the
  connection next.

Three kinds of code reach the database, and they need different things:

1. **The scoped handle** — `getOrgContext().db.run()`, where every domain query starts. It always
   has an org, and should see that org's rows and nothing else.
2. **The identity path** — Better Auth's adapter, `resolveActiveOrganization()` in
   `src/server/auth.ts`, and `resolveOrgForUser()` in `src/server/org-context.ts`. All of it runs
   before there is an org to scope by, and all of it has to read `memberships`, `organizations` and
   `invitations` to work out which org that will be. `docs/data-model.md` §9 recorded this as the
   chicken-and-egg #28 had to settle before enabling anything. Better Auth issues its queries
   directly through its adapter, so it cannot set a per-transaction setting even if one were
   defined for it.
3. **Maintenance** — migrations today; the demo org's nightly reset (#34) and the 30-day purge of
   deleted orgs later. None of it acts for one org on behalf of one person.

## Decision

**Two NOLOGIN roles, created by the migration that enables row-level security
(`drizzle/0006_row_level_security.sql`). Nothing logs in as either; a connection becomes one.**

- **`capexwise_scoped` is what every scoped transaction runs as.** `forOrg().run()` switches to it
  with `SET LOCAL ROLE`, in the same `set_config` statement that applies `app.current_org_id`, and
  asserts both took. It is not the owner and has no `BYPASSRLS`, so the policies apply to it
  whatever role the connection logged in as — superuser, owner or otherwise — and because both are
  `LOCAL`, neither survives the commit. It holds grants only on org-owned tables, each with the §9
  policy keyed on that table's org column. On `organizations` it gets `SELECT` and `UPDATE` and no
  more: an org is created at sign-in, on the identity path, and deleting one is a soft delete.
- **`capexwise_identity` is the identity path.** Its policies admit every row of exactly three
  tables — `organizations`, `memberships` and `invitations`, the ones that establish the boundary
  rather than sit inside it. It holds grants on those three and on the identity tables above the
  boundary (`users`, `sessions`, `accounts`, `verifications`, `rate_limits`), and on nothing else.
  No domain table ever gets a policy or a grant for it.
- **The login role is a member of both, in different ways.** `SET` on `capexwise_scoped` without
  `INHERIT`, so it can become the scoped role but does not carry the scoped role's policies around;
  `INHERIT` on `capexwise_identity`, so the identity path's policies apply to it directly. The
  migration grants both to the role that runs it. When this was decided, that was the login role in
  every environment, and on Neon the second grant was what kept sign-in working at all: an owner
  under `FORCE` with no policy that applies to it sees no rows. Production has since given the
  application a login of its own holding the same two memberships — the hardening step under
  Consequences, taken in #81.
- **`resolveOrgForUser()` runs on the identity path**, not through a scoped handle — the first of
  the three shapes #28 was asked to choose between. Its join is still the thing that decides which
  org a session may act in; the policy that lets it read `memberships` is the same one that lets
  Better Auth read it.
- **Policies compare against `current_org_id()`,** a SQL function that reads the setting, rather
  than repeating the expression. It spells the setting's name once in SQL, and it turns the empty
  string a `SET LOCAL` leaves behind into null, so a scoped role with no org sees nothing the same
  way on a fresh connection and a reused one.

**Who bypasses, and nobody else does:**

| Role | Why it is past the policies | What stops it being a hole |
| --- | --- | --- |
| The migration role (the table owner) | DDL is not subject to row-level security | It runs only in CI on `main` (ADR-0006), from the `production` environment's secret |
| The integration harness (`src/test/db.ts`) | It is the compose superuser, so that #27's test can tell a hidden row from one never written | It exists only under Vitest; the application under test logs in as `capexwise_test_app`, which is not |
| The identity path, on three tables | It has to read memberships before any of them is the context | Three tables wide, and `src/server/cross-org-isolation.integration.test.ts` fails if a fourth appears |

*Later:* [ADR-0010](0010-backups.md) adds a third NOLOGIN role, `capexwise_reader`, for the nightly
backup. It is not a row on this table, because it bypasses nothing. It reads every row through a
`for select` policy on each table that says it may, and it holds no write privilege anywhere.

A **data** migration that touches an org-owned table is the case this leaves open. The owner is
subject to `FORCE`, so on a login that is neither superuser nor `BYPASSRLS` it would see the three
identity-path tables and nothing of a domain table — an `UPDATE` that silently matches zero rows.
There are no data migrations yet. The demo reset (#34) is the first maintenance job that needs to
write across orgs, and it decides — with its own role and its own ADR, as ADR-0003 asked — rather
than inheriting a bypass from this one.

**The integration suite runs the application as a restricted login.** `capexwise_test_app` is not
the owner, has no `BYPASSRLS`, and holds exactly the two memberships above. Every Better Auth
endpoint and every `getOrgContext()` call under test therefore reads through the policies, and
removing the identity policy on `memberships` alone is enough to turn the auth, org-context and
isolation suites red.

## Alternatives considered

**A second connection string, with the application logging in as a restricted role.** The literal
reading of ADR-0003, and the design this one grows into. It lost on sequence rather than on merit.
It needs a login role with a password created by hand on every Neon branch, and a change to Vercel's
environment in every scope, before the first policy can be switched on. That turns a migration into
a coordinated release. It also buys the scoped path nothing: `SET LOCAL ROLE` puts scoped queries
under the same policies whatever the login is. What it adds is protection *from the unscoped
client* — `@/db/client`, used by the identity path — which would lose all access to domain tables.
That is worth having, and it is the hardening step under Consequences. It is also what the test
suite already runs as, so the day it is taken it has been tested for months.

**Key the `memberships` policy on the user, with an `app.current_user_id` setting.** "Which orgs
am I in" is a question about a person, and the `memberships_user` index already serves it. But it
moves the bootstrap rather than removing it. Better Auth cannot set the setting, so its reads of
the same three tables would still need a way past the policy. The result would narrow one of our
queries while the library's stayed open, which is complexity with no reduction in what the identity
path can reach.

**Set `app.current_org_id` from the session's `active_org_id` before the join.** The cheapest, and
it moves the boundary. The join would only confirm a value row-level security had already trusted,
which inverts ADR-0003's rule that the session is a hint and the membership join decides.

**Leave the three tenancy tables un-`FORCE`d and let the owner exemption carry the identity path.**
It works on Neon only for as long as the login role is the owner. It stops working the day the
hardening step is taken. And it makes "`FORCE` on every org-owned table" a rule with an exception
on the first three tables it was ever applied to.

**Declare the policies in the Drizzle schema** with `pgPolicy` and `.enableRLS()`, the support
[ADR-0001](0001-stack.md) cited when it chose Drizzle. The schema would then describe the policies
and not the grants, the role memberships or the `current_org_id()` function they depend on. That
splits the security model across two files, and the half that decides whether any of it applies
would sit in the hand-written one the generator does not check. One hand-written migration keeps it
readable top to bottom. The isolation test's registry reads the result back out of the catalog,
which checks it more directly than a declaration could.

**`BYPASSRLS` on the identity role.** Granting it takes a superuser or a role that already has it,
which a managed provider's owner may not be. It is also the opposite of narrow: it bypasses every
table, including every domain table not yet written.

## Consequences

**What this makes easy.** Row-level security applies to every scoped query in every environment
with no change to any environment, so reaching production is a migration and nothing else. The
role and the org are both transaction-local, which is what transaction-mode pooling requires, and a
test holds each of the `true`s that make them so. The identity path's reach is written down twice,
as grants and as policies, and a test fails if either grows. A forgotten grant on a new table fails
loudly — `permission denied` — rather than quietly.

**What this makes hard.** The per-table checklist in `docs/data-model.md` §9 grows: an org-owned
table needs a grant to `capexwise_scoped` as well as the policy, and the isolation test's registry
refuses a table that has one without the other. The two role names and the setting's name are
spelled once in TypeScript and once in SQL, and tests tie each pair together.

Two limits are worth stating plainly:

- **The unscoped client is only as restricted as the login role.** In production that is
  `capexwise_app`, which holds no grant on any domain table, so the unscoped client there gets
  `permission denied` rather than rows. Everywhere else the login is still past the policies: the
  compose superuser in local development and the end-to-end suite, and the Neon owner in preview
  deployments, which reads no domain rows under `FORCE` unless the provider has given it
  `BYPASSRLS`, and then reads all of them. ESLint's rule on `@/db/client` is the guard in those
  environments, as it was before this ADR. The integration suite runs as `capexwise_test_app`
  precisely so that the restricted shape is the one under test.
- **`RESET ROLE` inside a scoped transaction returns to the login role.** The role switch defends
  against a forgotten `where` clause, which is the failure ADR-0003 is about. It does not defend
  against code that deliberately undoes the switch. That is what ESLint's rules on `forOrg` and the
  raw client, and review, are for.

**The hardening step, deliberately not taken here, and taken in #81.** The application has a
login role of its own in production, `capexwise_app`: `LOGIN`, not the owner, no `BYPASSRLS`,
granted `capexwise_identity` with `INHERIT` and `capexwise_scoped` with `SET` only — exactly what
`capexwise_test_app` is. Vercel's production `DATABASE_URL` names it, on the pooled endpoint, and is
set by hand rather than by the Neon integration, which connects only as the owner; the integration
supplies Preview and Development and nothing else.
`PRODUCTION_DATABASE_URL` stays on the owner and the direct endpoint, because migrations need DDL.
It was created with SQL rather than in the Neon console: the console adds the roles it creates to
Neon's own administrative group, while a role created with SQL holds only what it is granted. No
code changed. The deadline was the first paying customer, which ADR-0003 set for this layer, or the
first domain table if that came sooner, and it landed before either. Previews stay on the owner,
for the reason the README gives under "The database".

**Roles are server-level, and no migration drops them.** Both are created only if absent, because
the integration suite migrates a second database on the same server. A role that holds privileges
in any database cannot be dropped without revoking them there first. Removing one is therefore a
deliberate operation on every branch, not something a migration does in passing.

**Cost of reversal.** Low. The roles, grants and policies are one migration. The role switch is one
line in `forOrg()`. The move to a second connection string is additive — the hardening step above —
rather than a reversal.
