# Contributing

CapExWise is a solo project. This file exists because the repository goes public at v0.5, and
because a convention that lives only in one person's head is not a convention — it is a habit
that drifts. `CLAUDE.md` holds the working rules for the code; this holds the rules for the
history and the pull request.

## Branches

One branch per issue, named `type/short-description`:

| Prefix | For |
| --- | --- |
| `feat/` | New product behaviour |
| `fix/` | A defect in behaviour that already shipped |
| `docs/` | Markdown only, no code |
| `chore/` | Tooling, CI, dependencies, configuration |
| `refactor/` | Behaviour identical, shape different |

One open pull request at a time where practical. `main` is never pushed to directly.

## Commits

**No Conventional Commits.** No `feat:`, no `fix:`, no scopes, no `BREAKING CHANGE` footer.

The reason is that every prefix it would add is already recorded somewhere better. The branch
prefix carries the type. The issue carries the intent. The pull request carries the discussion.
And because merges are squashed one-per-issue, `git log main` is already exactly one line per
unit of work — the shape Conventional Commits exists to recover from a messy history that this
repository does not produce. There is no changelog generator and no semantic-release consuming
the prefixes, so they would be ceremony paid for nothing. This is reversible: adopting them later
costs a linter, and the history before the switch stays readable either way.

What is required instead:

- **A subject that reads as a sentence**, in sentence case, no trailing full stop, under about
  seventy characters. Imperative where the commit does something — *Drop the browser cache*,
  *Stop setting `output: "standalone"` on Vercel* — and a noun phrase where it introduces
  something — *Test harness: Vitest unit and integration, Playwright e2e*.
- **The `topic: detail` shape when it earns its place.** A colon buys a specific subject inside a
  short one. It is not a type prefix and nothing parses it.
- **A body saying why, whenever the why is not obvious from the subject.** The diff already says
  what changed. The body is for the reason, the alternative that was rejected, and the constraint
  that forced it. This is the part that is worth writing.
- **`Closes #12` in the body** so the board moves itself.

Do not write the pull request number into a commit subject by hand. GitHub appends it on squash.

### Small commits, each standing alone

A commit inside a pull request should build, pass its tests, and be reviewable on its own. The
commit is the review unit, not the pull request — a branch of six coherent commits is read; a
branch of one enormous commit is skimmed.

## Pull requests

The template prompts for the rest. The one thing it cannot check for you:

- **Run `/code-review` before opening any pull request that touches code.** Markdown-only changes
  skip it.

**Screenshots are optional.** A UI change is reviewed by running the branch, which sees hover,
focus, keyboard order and real data — none of which a still shows. Attach one when it carries
something a local run would not: a state that is awkward to reach, or a before-and-after.

Squash merge only. Merge commits and rebase merges are disabled at the repository level, branches
delete on merge, and history stays linear by construction.

## Branch protection

`main` has no enforced protection rule today, and this is a plan limit rather than a decision:
GitHub does not offer branch protection or rulesets on a **private** repository outside a paid
plan, and the API returns `403 Upgrade to GitHub Pro or make this repository public` for both.

The decision is to **wait for v0.5 rather than pay for Pro**. The convention has held across
seventy-odd pull requests without a rule behind it, the repository goes public on a date that is
already on the release plan, and that same date is what makes CodeQL, secret scanning and push
protection free too — so paying now buys a few months of enforcement on a single-contributor
repository and nothing else.

At v0.5, then, create one ruleset on `main`:

- Require a pull request before merging
- Require status checks to pass: **Types, lint and schema**, **Production build**,
  **Unit, integration and end-to-end**, **Build and run the image** — the four jobs in
  [`ci.yml`](.github/workflows/ci.yml), by their display names
- Require branches to be up to date before merging
- Require linear history
- Block force pushes and deletions

Going public also makes free the three things that need GitHub Advanced Security while the
repository is private. CodeQL code scanning needs nothing done: the workflow is already committed
and [guards itself on visibility](.github/workflows/codeql.yml). Secret scanning and push
protection are settings rather than files, and GitHub turns both on by default for public
repositories — so confirm they are on rather than assuming either way.

## Dependencies

Dependabot runs weekly and groups minor and patch updates into one pull request per ecosystem.
Two majors are pinned shut in [`dependabot.yml`](.github/dependabot.yml) because they are
contracts rather than preferences: **ESLint stays on 9**, and **Node stays on 24**. Read the
comment there before unpinning either.

That file is only the version-updates half. The other half is two repository settings, both on
and neither in a file: **vulnerability alerts** and **Dependabot security updates**, the second
of which opens a pull request as soon as a CVE lands in the lockfile rather than waiting for the
weekly run. Both are free on a private repository, so unlike everything under Branch protection
above, neither waits for v0.5.
