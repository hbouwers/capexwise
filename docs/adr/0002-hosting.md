# ADR-0002: Hosting

**Status:** Proposed — accepted on merge of the PR that adds it
**Date:** 2026-09-08
**Decided by:** Holden

## Context

ADR-0001 produces a Node application and a Postgres database. Three things have to be true of
wherever it runs:

1. **The demo has to be public and free to keep running** (v0.5). It is a portfolio artifact, so
   its cost is paid indefinitely with no revenue attached to it.
2. **Stripe arrives at v1.** The moment money changes hands the deployment is a commercial one,
   and that is a licensing question before it is a technical one.
3. **The exit has to stay cheap.** Hosting is the decision most likely to be forced by someone
   else's pricing change, so the cost of leaving matters more than the cost of staying.

The forcing function is specific and already recorded as decided: **Vercel's Hobby tier forbids
commercial use.** That is not a scaling limit that can be deferred by staying small — it is a
licence term that Stripe going live violates on day one, regardless of traffic.

## Decision

**Vercel Hobby now. Move to Vercel Pro or Google Cloud Run at the first paying customer. Maintain a
working Dockerfile from commit one, built by CI on every pull request.**

- **Vercel Hobby through v0 and v0.5.** Personal use and a public demo are within the tier, and the
  preview deployment per pull request is real review value for a solo developer who has no one else
  to click through a change.
- **The trigger to move is Stripe going live, not a traffic threshold.** Whichever comes first
  between the first paying org and any commercial use, the deployment moves. Vercel Pro is the
  low-effort move; Cloud Run is the low-cost, low-lock-in one. That choice is deliberately deferred
  to the moment it is forced, because the inputs — actual traffic shape, actual bill — do not exist
  yet.
- **A Dockerfile exists from commit one and CI builds it on every PR** (#19, #22). Not as
  documentation, and not as a thing to write when needed. A container image that has been built and
  run today is the entire difference between the migration being an afternoon and being a project.
- **No Vercel-only primitive goes in the hot path without a documented fallback.** Concretely:
  - **Middleware** — keep it thin, and keep authorisation decisions in the request handlers where
    ADR-0003's `getOrgContext()` runs. Edge middleware is a routing convenience, never the security
    boundary.
  - **Image optimisation** — a self-hostable loader, or none.
  - **Cron** — the nightly demo reset (#34) runs as a container entrypoint that Vercel Cron or
    Cloud Scheduler can both call.
  - **Blob storage** — when documents arrive (#40), S3-compatible, not Vercel Blob.
  - **KV / Edge Config** — Postgres.

## Alternatives considered

**Cloud Run from day one.** The destination, so starting there avoids a migration entirely. It
loses on what it costs before the migration is needed: no zero-config preview deployment per pull
request, more build and deploy configuration to maintain during the phase where the product does
not exist yet, and a slower edit-to-URL loop at exactly the point where iteration speed matters
most. The Dockerfile requirement above means we are not actually deferring the hard part, only the
plumbing.

**Vercel forever, moving Hobby to Pro and staying.** Entirely viable and probably what happens if
the product stays small. It is not written as the decision because it makes the exit expensive by
neglect — the failure mode is not choosing Vercel, it is arriving at a pricing change with no
tested container image and discovering the move is a quarter's work.

**Fly.io, Railway, or Render.** All reasonable, all cheaper than Vercel Pro, none with Vercel's
Next.js integration or preview-deployment ergonomics. They lose the pre-revenue comparison on
developer experience and win the post-revenue one on price — which is an argument for revisiting at
the trigger, not for switching now. Cloud Run is preferred among them mainly because the container
is already the migration artifact and GCP is where the escape hatch was designed to land.

**A VPS running Docker Compose.** Cheapest, and the most operational work: patching, TLS renewal,
backups, and being the person paged. For a solo developer whose scarce resource is attention, that
is the wrong trade.

## Consequences

**What this makes easy.** Preview deployments per PR, free, which is the closest thing to a second
reviewer this project has. Zero hosting cost through v0 and v0.5, so the demo can run indefinitely
as a portfolio artifact. And a genuinely credible exit, because the container image is exercised
continuously rather than assumed.

**What this makes hard.** The Dockerfile is a small tax paid on every PR forever, and a green
container build is a CI job that can fail for reasons unrelated to the change under review. The
no-Vercel-primitives rule costs real convenience — Vercel Blob and Edge Config are genuinely nicer
than the portable alternatives, and we decline them on purpose. Serverless request handlers also
constrain the database layer: connections are pooled and reused across requests, which is precisely
why ADR-0003 requires `SET LOCAL` inside a transaction rather than a session-level `SET`, and why
the pooling mode in #33 is a security-relevant choice rather than a performance one.

**Cost of reversal.** Hours to a day while the Dockerfile is green, and a multi-week project the
moment it is not — the whole design here is an attempt to keep that number in the first bucket. The
move to Vercel Pro is a billing change and near-free. The move to Cloud Run is a container deploy,
a database connection string, a scheduler entry for the demo reset, and DNS. Nothing in the
application code should need to change, and if something does, that is the signal that a
Vercel-only primitive got into the hot path after all.
