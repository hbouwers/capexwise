# ADR-0006: Migrations — forward-only, and run outside the build

**Status:** Accepted
**Date:** 2026-09-08 (accepted 2026-09-09, when the migrate job landed)
**Decided by:** Holden

## Context

[ADR-0001](0001-stack.md) chose Drizzle, which generates SQL migration files and commits them.
That settles the format and nothing about the operation of it. Issue #17 names the two questions
left: **who applies a migration when a deploy happens**, and **what happens when one was wrong**.

Both are cheap to answer now and expensive to answer during an incident, which is the whole reason
they are being answered before there is any data to lose.

What is already fixed and constrains the answer:

- **[ADR-0002](0002-hosting.md) puts the application on Vercel**, deployed from git. A push to a
  branch builds a preview; a push to `main` builds production. Vercel runs no migrations of its
  own, and it offers instant rollback of a *deployment* — which does nothing to the database.
- **A build is not a deployment step.** Vercel builds run for previews as well as production, they
  can be skipped when the output is cached, and they can run concurrently. Whatever applies
  migrations has to happen exactly once per release, and a build is not that.
- **Postgres is managed and provisioned in #33**, so the database is reachable over the network
  with a connection string and nothing more exotic.
- **CI exists in #22**, and is where a job of this shape belongs.
- **This is a solo project.** A process that needs two people to be safe is not a process that will
  be followed.

## Decision

### Migrations run in CI, on `main`, never in the build

`npm run db:migrate` runs as its own GitHub Actions job, triggered by a push to `main`, with a
concurrency group so two runs can never overlap. It is not part of `next build`, not part of the
Vercel build command, and not run by the application at boot or on first request.

It runs with credentials that belong to CI. No developer needs production database credentials on
their machine, and a laptop is never the thing that migrates production.

### Every migration is compatible with the release already running

This is the load-bearing half, and it is what makes the first decision safe rather than merely
tidy. Vercel's git integration starts its build when the push lands, so the migrate job and the new
deployment overlap by construction. **Rather than trying to order them, the ordering is made not to
matter.**

Expand, then contract, across releases:

1. **Expand.** Add the table, or the nullable-or-defaulted column. The running release does not
   know about it and does not care. Deploy the code that writes it.
2. **Migrate the data**, if there is any to move, in its own migration.
3. **Contract.** Once no running release reads the old shape, drop it — in a *later* pull request
   than the one that stopped using it.

Concretely: a new column is nullable or has a default, never `NOT NULL` without one. A rename is an
add, a backfill and a drop — three migrations, not one. A `DROP COLUMN` or `DROP TABLE` goes in a
migration of its own, never in the same PR as the code change that stopped needing it.

The payoff is not theoretical. It is the only thing that keeps Vercel's instant rollback usable: a
rollback moves the code back one release and leaves the schema where it is, so the previous release
has to be able to run against the newer schema. If it cannot, the rollback button is a trap.

### Forward-only. There are no down migrations

Drizzle does not generate them, and they are not being written by hand. A mistake is corrected by
writing the next migration.

`drizzle-kit push` is not used at all. It diffs the schema straight onto a database and leaves no
migration file, which is fine on a scratch branch and indistinguishable from unaudited data loss on
anything else. Schema changes always go through a generated, reviewed, committed file — and the
drift check fails the build if a schema change arrives without one.

### The migration role is not the application role

The runner opens its own connection rather than borrowing the application's pool. That is a shape
decision today and a necessity once #28 turns on `FORCE ROW LEVEL SECURITY`, which exempts nobody —
including the table owner. Migrations need a role that can run DDL; the application needs one that
cannot. Keeping them separate from the start makes that split a second connection string later
rather than a rewrite.

*#28 met this with a role switch rather than a second login — every scoped transaction runs as a
role the policies apply to, whatever it connected as — and left the second connection string as a
hardening step. [ADR-0007](0007-database-roles.md) is that decision, and #81 took the step: in
production the application logs in as a role of its own and leaves the owner to this runner.*

## Alternatives considered

**Migrate in the Vercel build — `"build": "db:migrate && next build"`.** The most commonly
suggested answer, and the one this rejects hardest. A preview build would migrate whichever database
its environment points at, so any feature branch could alter production's schema before its code was
reviewed. Builds are also cached, skippable and concurrent, so "once per release" is not a property
a build has. And a build that migrates and then fails leaves the schema ahead of every running
deployment, with nothing deployed to explain why.

**Migrate at application boot, or on the first request.** Attractive because it needs no
infrastructure. Rejected on the runtime model: serverless means many instances cold-starting at
once, each racing for the same migration lock, with the request that lost waiting on DDL. A failed
migration becomes a 500 to a user instead of a red pipeline, which is the wrong place to find out.

**Deploy from Actions with the Vercel CLI, strictly after the migrate job.** This buys real
ordering: migrate, then promote. Rejected for now because it replaces the git integration that gives
preview deployments for free and adds a deploy pipeline to maintain, in exchange for a guarantee
that expand-then-contract already provides. It is the named escape hatch if a migration ever
genuinely cannot be made backward-compatible — but reaching for it should feel like a concession,
because the migration that needs it is also the migration that breaks rollback.

**Reversible migrations, with a hand-written `down` for each.** Rejected on honesty. A `down` for
anything that dropped a column or rewrote data cannot restore what it removed, so the ones that
matter most are the ones that lie. They are written while calm, never executed, and then run for the
first time during an incident against a database that does not match the fixture they were imagined
against. Restore-from-backup is the actual recovery path for lost data; a new forward migration is
the actual recovery path for a wrong schema.

**Run `npm run db:migrate` by hand after each deploy.** Honest about being manual, and it works
until the first time it is forgotten — which on a solo project is a matter of when. It also puts
production credentials on a laptop, permanently, to save writing one CI job once.

## Consequences

**What this makes easy.** A deploy is a push, with no step to remember. The migrate job is the only
thing holding production credentials. Instant rollback stays a real option rather than a button
nobody dares press. And because the drift check is file-based — it compares the schema against the
committed snapshots and never opens a connection — CI can enforce "the migration is committed"
without provisioning a database for the job.

**What this makes hard.** Expand-then-contract is three pull requests where one would do, and the
third is the one that gets forgotten: a nullable column that was meant to become `NOT NULL` stays
nullable, and the type in the application is wider than the data warrants forever. The discipline is
the cost, and it is paid on every schema change rather than once. A rename in particular stops being
a rename and becomes a small project.

Forward-only also means a destructive migration that reaches `main` is not undone by reverting the
commit. The revert restores the code; the column is still gone. **What protects against that is
review of the SQL, not the ability to reverse it** — which is why a generated migration is read as
part of the pull request rather than treated as build output.

**Cost of reversal.** Low, and asymmetric. The operational half — where the migrate job lives — is a
CI workflow and a connection string, so moving to CLI-driven deploys is an afternoon. The
expand-then-contract discipline is free to abandon and expensive to have abandoned: the first
migration written without it is the one that makes rollback unsafe, and that is discovered during a
rollback. Nothing here is expensive to change; one thing here is expensive to have gotten wrong
once.

## Sources

- Vercel deployment model — git-triggered builds, preview versus production environments, and
  instant rollback operating on deployments rather than on data. Checked 2026-09-08
- Drizzle Kit — `generate` and `migrate` produce and apply committed SQL files, while `push` applies
  a diff directly and leaves no migration history. Checked 2026-09-08
