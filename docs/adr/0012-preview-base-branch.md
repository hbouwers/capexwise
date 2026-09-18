# ADR-0012: Preview branches start from an empty, migrated base

**Status:** Proposed — accepted on merge of the PR that adds it
**Date:** 2026-09-18
**Decided by:** Holden

## Context

Every pull request gets a Vercel preview, and the Vercel-managed Neon integration gives each one a
Neon branch, `preview/<git branch>`. A Neon branch is a copy-on-write child of its parent, rows
included. Until now that parent was `main`, production's own branch, so every preview held a full
copy of production's rows (#85). The copy sits on a branch that exists for code review. The owner
role can read it, and a pull request's unmerged code runs against it. Dependabot's pull requests
count too.

What those rows are depends on the stage:

- **Through v0**: Holden's user, account and session rows, and his portfolio.
- **From v0.5**: one `users` row for each visitor to the public demo (ADR-0011). Those rows
  identify nobody, but they belong to other people all the same. #133 merged the demo, so v0.5 is
  already here.
- **At v1**: every customer's buildings, contacts and email address.

Access codes were already covered. Preview has its own `ACCESS_CODE_KEYS`, so it cannot open
production's (ADR-0008). No other column is covered.

What Neon and Vercel allow, checked on 2026-09-18 against Neon's documentation:

- **Neither integration lets you choose the parent.** Neon's documentation says the Neon-managed
  integration creates preview branches from the project's **default branch**. The Vercel-managed
  integration, which this project uses, has no setting for the parent. Neither offers schema-only
  previews.
- **Any branch can be the default.** It is one setting in the console, the CLI or the API, and it
  decides three things: where the integrations branch from, which parent a new branch gets when
  none is named, and which branch the console selects first.
- **A branch that is not the default can be archived**, once it is older than 14 days and has not
  been accessed for 24 hours. It unarchives by itself on the next connection, at the cost of a
  slower first connection. The documented exemptions are a running compute, an unarchived child
  branch, and protection. Protected branches need a paid plan.
- **Schema-only branches** exist (beta). They are root branches with no parent, and they copy the
  structure but no rows. That includes the rows of `drizzle.__drizzle_migrations`, so the migrator
  would treat such a branch as unmigrated. It also includes the rows migrations write themselves:
  the trade tags (0013) and the capital item catalogue (0020). **And this project cannot create
  one.** Neon refuses with `project with a legacy web access role do not support schema-only
  branches; role:"capexwise_reader"`. The roles the migrations and #81 created with SQL are ones
  Neon will not recreate on a new root branch, and that is not something to undo.
- **A branch copies its parent's roles too**, passwords included. A child of `main` can log in as
  `capexwise_app` and `capexwise_backup` with production's passwords, on its own endpoint.
- **Restoring a root branch that has children moves the children** onto the backup branch the
  restore creates, and a branch with children cannot be deleted.
- **The Free plan allows three root branches**, and Neon counts a restore's backup branch among
  them.

Nothing that holds a real credential depends on the default branch. Vercel's production
`DATABASE_URL`, the migrate job's `PRODUCTION_DATABASE_URL` and the backup's
`BACKUP_DATABASE_URL` are all set by hand to `main`'s endpoints. Changing the default moves none of
them.

## Decision

**A branch named `preview-base` is the Neon project's default branch.** It holds the migrated
schema and the rows the migrations write, and nothing else. Every preview branch is created from
it.

- **It is a child of `main`, emptied.** Dropping the `public` and `drizzle` schemas and running
  every migration from `0000` gives the same database the integration suite builds on every pull
  request: the journal, the trade tags and the catalogue, and no other rows. A preview branches
  from the base's current state, so that is all it sees. The rows from before the drop stay in the
  base's own history until it ages out. Only someone in the Neon console can reach them there, and
  that person can already read `main`.
- **Its copies of production's credentials are cut.** The owner's password is reset on the base,
  and `capexwise_app` and `capexwise_backup` lose their login and their password there. A preview
  copies the base's roles, so no preview holds a production password either. Until now, every
  preview did.
- **CI keeps it migrated.** The migrate job applies migrations to production and then to
  `preview-base`, on every push to `main`, from `PREVIEW_BASE_DATABASE_URL` in the same
  `production` environment. Production goes first. A failure on the base turns the run red, but it
  cannot stop a release that already reached production.
- **A preview's database starts empty, not with the demo.** The demo is written by the application
  (ADR-0011), because the application holds the schema, the scoped role and the keyring. Seeding
  the base would mean either a copy of the reset outside the application, holding a keyring, or a
  call to a preview deployment. Vercel Authentication blocks that call unless it carries a
  bypass token. So a preview shows the sign-in page without "Explore the demo", as it did before,
  because `findDemoOrgId()` finds nothing to offer.
- **`main` stays production's branch**, under the same name and the same endpoints. Nothing that
  connects to production changes.

## Alternatives considered

**Keep branching from `main`, and scrub each preview.** A job that deletes the rows after the
integration creates the branch. The copy exists before the job runs. The branch's history still
holds every row, so a restore to a moment before the scrub brings them back. And a job that
fails leaves the copy in place, with nothing flagging it. Rejected.

**A schema-only branch as the base.** Neon's feature for exactly this concern, and the first
version of this decision, because a root branch carries none of `main`'s rows or history at all.
Neon refuses to create one in this project (Context). Used as it came it would not have worked
either: it copies no rows, so the migration journal is empty and the next `npm run db:migrate`
fails on `0000`'s `CREATE TYPE`, and the catalogue and trade tags that the equipment checklist and
the contact book read would be missing. Not possible.

**A root branch made some other way.** Neon makes a root branch only as a schema-only branch or as
a restore's backup, and a backup is a full copy of `main`. A second Neon project would start empty,
but the Vercel integration connects one project. Not possible.

**A child of `main`, truncated rather than rebuilt.** Truncating every table keeps the journal, but
it needs a list of tables kept in step with the migrations, and it empties the catalogue and the
trade tags along with everything else. Dropping the schemas and migrating from `0000` builds the
database the integration suite already tests. Rejected in favour of the rebuild.

**The Neon-managed integration, or preview branches created from CI.** Neither is needed. The
Neon-managed integration also branches from the default, so switching to it buys nothing, and the
two integrations cannot coexist on one Vercel project. Creating branches from CI would work with
any parent. But it takes over what the integration does today, writing each preview's
`DATABASE_URL` into the deployment, and it would need a Vercel token in GitHub. Kept as the fallback
if the Vercel-managed integration turns out to ignore the default branch.

**Seed the demo into the base.** It would let a preview show signed-in pages through anonymous
sign-in, the benefit ADR-0011 names. Deferred, not rejected, for the reasons under Decision.
Reversing this is cheap: the base is ordinary data, and a seeded base changes nothing about how
previews branch from it.

## Consequences

**What this makes easy.** A preview holds nobody's data and no production password, at v0.5 or at
v1, and nothing has to run after the branch is created to make that true. Reviewing a migration against a preview still
works, because the base is always at `main`'s latest migration. The Neon console now opens on
`preview-base`. That makes the console's default the safe branch rather than production, and a
query typed without looking lands on an empty database.

**What this makes hard.**

- **`Reset from parent` on the base copies production into it.** The base's parent is `main`, so
  that one console button undoes everything above. Never use it on the base. Rebuild it instead,
  with the drop and the migration, as the README says.
- **Every console step on production has to name `main`.** The Connect dialog, the SQL editor and
  the Tables page all start on the default branch. The README and the runbook say `main` wherever
  it matters.
- **A restore of `main` moves the base.** Neon moves `main`'s children onto the backup branch the
  restore creates, so the base, and every preview under it, then hangs off that backup. Previews
  keep working. But the backup cannot be deleted while the base is under it, and it holds one of
  the Free plan's three root branches. The runbook says how to rebuild the base on `main` when the
  backup has to go.
- **`main` is still never archived.** It is no longer the default, but a branch with an unarchived
  child is exempt, and the base, being the default, is never archived.
- **A second database to migrate.** A migration that assumes rows exist, for example one that
  updates rows it expects to find, has to succeed on an empty base as well. The integration suite
  already runs every migration against an empty database, so this failure shows up on the pull
  request first.
- **Previews still cannot sign in.** That is unchanged, but the demo was a way out of it, and it is
  deferred.

**Cost of reversal.** Low. Setting `main` as the default again restores the old behaviour for
every preview created after that, and it brings the old problem back with it. Deleting
`preview-base` and the CI step removes the rest.

**Revised before merge.** The first version made the base a schema-only root branch, and Neon
refused to create one (Context). A child of `main`, emptied the same way, replaced it.
