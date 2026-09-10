# ADR-0009: One production, and the way back to Hobby

**Status:** Proposed — accepted on merge of the PR that adds it
**Date:** 2026-09-10
**Decided by:** Holden

## Context

[ADR-0002](0002-hosting.md) moves production off Vercel Hobby at the first paying customer, to Cloud
Run or Vercel Pro. It says nothing about the reverse move. Two things have to outlive the paid
product, whether or not it earns its keep:

1. **Holden's own portfolio.** He uses the application for his own buildings, and it has to keep
   running at no cost.
2. **The demo.** v0.5 exists to be a link someone clicks in an interview, and it has to be up
   whenever that happens.

The proposal was two deployments of the one codebase. A Vercel Hobby instance would hold personal
use, a free test group and interview demos. A separate Cloud Run instance would hold paying
customers, and could be switched off without touching the first.

Two facts shape the answer.

- **The data is on neither host.** Production's database is Neon (#33), reached by a connection
  string. Vercel and Cloud Run only run the application, and ADR-0002 keeps it portable between them
  on purpose: the container is built on every pull request. Moving the application between hosts is
  a deploy, its secrets, and DNS, in either direction.
- **Hobby's licence is about what a deployment is for, not how busy it is.** Vercel defines
  commercial use as any deployment used for the financial gain of anyone involved in producing the
  project. Its examples include requesting payment from visitors and advertising a product for sale.
  Personal use and a portfolio demo are within the tier. A test group of prospective customers,
  trying a product that is sold on another host, is arguable at best.

## Decision

**One production deployment at every stage, at `capexwise.com`. Leaving the paid product means
moving production back to Hobby. It does not mean keeping a second deployment alive just in case.**

- **Every org lives in production:** Holden's, the demo org, every tester's and every customer's,
  in one database, as CLAUDE.md's first hard rule already requires. Testers are ordinary free orgs,
  because the permanent free first unit already is the free tier (PRD §12). A tester converts by
  adding a second unit, without moving between databases.
- **It runs on Hobby until the first paying customer**, then wherever ADR-0002's trigger sends it.
- **`capexwise.com` is production's address from now on**, pointed at Vercel. Changing hosts is then
  a DNS change, in both directions. The demo link, the OAuth redirect and every signed-in session
  survive it, because none of them names the host.

### The way back

If the paid product shuts down:

1. **Stop taking money.** Cancel every subscription and switch billing off (below).
2. **Close the customers' orgs.** Give notice and an export, then delete them. After that, production
   serves nobody's financial gain, which is what makes Hobby permissible again.
3. **Deploy the same commit to the Vercel project's Production environment, with production's
   existing values.** That means the same `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ACCESS_CODE_KEYS`
   and Google client: the same database, the same keys.
4. **Point `capexwise.com` at Vercel**, and move the nightly demo reset (#34) from Cloud Scheduler
   to Vercel Cron.
5. **Shut down the Cloud Run service** and anything only it used.

Customer rows stay in backups until the retention in #35 expires them. The shutdown is complete then,
not before. From Vercel Pro rather than Cloud Run, steps 3 to 5 are a plan downgrade.

### What it requires of work done before then

- **Billing can be switched off.** A Hobby deployment may not ask its visitors for money. So the
  application has to run with no Stripe configuration at all, and in that state show no upgrade
  prompt, no checkout and no pricing call to action. The billing work (v1) builds to that:
  - The Stripe variables are optional as a group in `src/lib/env-schema.mts`.
  - Their absence means billing is off, not a boot error.
  - Holden's org and the demo org hold more than the free unit without depending on billing. How
    they do that is the billing work's to decide.
- **Production's secrets belong to its database, not to its host.** Moving hosts moves them unchanged.
  - `ACCESS_CODE_KEYS` opens what is sealed in that database ([ADR-0008](0008-access-code-encryption.md)).
    Generating a new one for the new host would lose every access code.
  - `BETTER_AUTH_SECRET` signs its sessions and encrypts the OAuth tokens it stores. A new one would
    sign everyone out.

  Both are per environment, and production is one environment wherever it runs. The password
  manager copy that ADR-0008 requires is what makes a move possible after Vercel stops showing a
  Sensitive value.
- **ADR-0002's rule against Vercel-only primitives in the hot path now covers both directions.** A
  Cloud Run-only primitive would block the way back in the same way.

## Alternatives considered

**Two deployments: Hobby for personal use, testers and demos, Cloud Run for customers.** Its
strengths are that it keeps Holden's data out of the customers' database, and that shutting the paid
half down is a single step. It lost on four counts.

- **The licence.** The free test group, and demos of a product that is for sale, are the least
  clearly permitted parts of the Hobby half. The only clearly permitted version limits that half to
  Holden and the interview demo, and then the testers are on the paid side anyway.
- **Two productions for the life of the product.**
  - Every migration is applied to two databases by two jobs, and one failing leaves the same code
    running on two schemas.
  - Every secret exists twice, and so does the backup setup (#35).
- **A second product mode.** The Hobby half must never charge, so the plan gate needs an exemption
  for the whole deployment, which the paid half must never have. Every release would have to be
  tested in both modes.
- **Stranded testers.** A tester who decides to pay has to be moved from one database to the other.
  That is an org export and import, which the product would otherwise never need.

The fallback this option offers is the way back above, which costs nothing until it is used.

**Keep the paid deployment running with no customers.** Cloud Run scales to zero, so the compute
costs little. But everything sized for customers stays too, starting with the Neon plan, and it
remains a commercial deployment. The way back is cheap enough that paying to avoid it buys nothing.

**Production on `capexwise.vercel.app` until the move.** The address would change at the move, and
again on the way back. Each change breaks the demo link already given out, signs everyone out
(cookies belong to a host), and needs a new OAuth redirect. The domain is registered (#3), and a
custom domain is free on Hobby.

## Consequences

**What this makes easy.** One database, one migration path, one set of production secrets, and one
place to look when something is wrong. Shutting the business down keeps the personal application
and the demo, with their data and history, at no ongoing cost. Testers convert where they already
are.

**What this makes hard.**
- **Holden's data shares a database with customers' data.** Row-level security protects it the same
  way it protects theirs, which is the intent of the hard rule. But his portfolio is exposed in any
  incident involving customer data, and in every preview branch until #85 lands.
- **Billing is constrained.** It has to switch off cleanly, which it would not otherwise need to.
- **The way back takes time.** Its steps involve customers (notice, export, deletion), and it ends
  only when the last backup holding their rows expires.

**Cost of reversal.** Splitting into two deployments later means creating the second database and
moving orgs into it. The export and import that needs is the same work this decision avoids. It stays
cheap while production holds only Holden's org and the demo.
