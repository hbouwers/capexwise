# Architecture decision records

One file per decision, numbered, never deleted. A decision that turns out to be wrong gets a new
ADR that supersedes the old one; the old file stays, with a note pointing forward. The value is
the record of *why*, including the options that were rejected — that is the part nobody
reconstructs from the code six months later.

## Naming

`NNNN-short-kebab-title.md`, e.g. `0003-multi-tenancy.md`. Numbers are allocated in order and
never reused.

## Template

```markdown
# ADR-NNNN: Title

**Status:** Proposed | Accepted | Superseded by ADR-NNNN
**Date:** YYYY-MM-DD
**Decided by:** name

## Context

What forces are in play. Constraints, requirements, and what is already true. Enough that someone
who was not there can tell whether the decision still applies.

## Decision

What was chosen, stated plainly and in the present tense.

## Alternatives considered

Each option, and the specific reason it lost. An ADR with no rejected alternatives is a note, not
a decision record.

## Consequences

What this makes easy, what it makes hard, and what it costs to reverse. Name the cost of reversal
explicitly — it is the number that matters when the decision is revisited.
```

## Written

New decisions take the next number and are added here in the same pull request.

| ADR | Subject | Issue |
| --- | --- | --- |
| [0001](0001-stack.md) | Stack — Next.js App Router, TypeScript, Postgres, Drizzle | [#4](https://github.com/hbouwers/capexwise/issues/4) |
| [0002](0002-hosting.md) | Hosting — Vercel now, Cloud Run as the escape hatch | [#5](https://github.com/hbouwers/capexwise/issues/5) |
| [0003](0003-multi-tenancy.md) | Multi-tenancy — org_id everywhere, server-resolved context, RLS as layer two | [#6](https://github.com/hbouwers/capexwise/issues/6) |
| [0004](0004-auth-provider.md) | Auth provider — Better Auth, orgs in our own Postgres | [#7](https://github.com/hbouwers/capexwise/issues/7) |
| [0005](0005-identifiers-money-dates.md) | Identifiers, money, and dates | [#8](https://github.com/hbouwers/capexwise/issues/8) |
| [0006](0006-migrations.md) | Migrations — forward-only, run outside the build | [#17](https://github.com/hbouwers/capexwise/issues/17) |
| [0007](0007-database-roles.md) | Database roles — the scoped role, the identity path, and who bypasses RLS | [#28](https://github.com/hbouwers/capexwise/issues/28) |
| [0008](0008-access-code-encryption.md) | Access codes — sealed in the application, keyed per environment | [#31](https://github.com/hbouwers/capexwise/issues/31) |
| [0009](0009-one-production.md) | One production, and the way back to Hobby | [#86](https://github.com/hbouwers/capexwise/issues/86) |
| [0010](0010-backups.md) | Backups — a nightly dump that is also a restore drill | [#35](https://github.com/hbouwers/capexwise/issues/35) |
