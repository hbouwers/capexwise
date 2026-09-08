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

## Written and planned

A linked number is written; the rest are placeholders holding their slot in the numbering.

| ADR | Subject | Issue |
| --- | --- | --- |
| 0001 | Stack — Next.js App Router, TypeScript, Postgres, Drizzle | [#4](https://github.com/hbouwers/propex/issues/4) |
| 0002 | Hosting — Vercel now, Cloud Run as the escape hatch | [#5](https://github.com/hbouwers/propex/issues/5) |
| 0003 | Multi-tenancy — org_id everywhere, server-resolved context, RLS as layer two | [#6](https://github.com/hbouwers/propex/issues/6) |
| [0004](0004-auth-provider.md) | Auth provider — Better Auth, orgs in our own Postgres | [#7](https://github.com/hbouwers/propex/issues/7) |
| 0005 | Identifiers, money, and dates | [#8](https://github.com/hbouwers/propex/issues/8) |
