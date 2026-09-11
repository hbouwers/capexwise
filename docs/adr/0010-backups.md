# ADR-0010: Backups — a nightly dump that is also a restore drill

**Status:** Proposed — accepted on merge of the PR that adds it
**Date:** 2026-09-11
**Decided by:** Holden

## Context

The product is a multi-year planning record: when a roof went on, what it cost, what the
depreciation schedule says, what the reserve should be. None of it can be rebuilt from memory, so
losing it is worse than downtime (#35).

What is already true:

- **Production is one Neon branch** (#33, [ADR-0009](0009-one-production.md)), on the free plan.
  Checked on 2026-09-11, that plan's restore window is **6 hours** of history. It includes **one
  manual snapshot** and no scheduled backups. The paid Launch plan raises the window to 7 days and
  adds scheduled snapshots. So a mistake noticed the next morning cannot be undone with what Neon
  gives now.
- **The owner cannot take a backup.** `FORCE` subjects the table owner to its own policies, and
  [ADR-0007](0007-database-roles.md) measured that Neon's owner has no `BYPASSRLS`. `pg_dump` turns
  row security off by default, and it then fails on every table that has row security. With
  `--enable-row-security` it succeeds, but it writes out only the rows a policy admits. For the
  owner that is the three identity-path tables and none of any domain table. A backup that
  restores cleanly and holds nothing is the worst kind, because it is found out the day it is
  needed.
- **Nothing we log in as can bypass row security either.** Creating a `BYPASSRLS` role takes a role
  that already has it. ADR-0007 turned `BYPASSRLS` down for the identity role for that reason, and
  because it reaches past every policy, including ones not yet written.
- **The repository goes public at v0.5**, and so do its workflow logs and run summaries.
- **What a dump would hold.** Access codes are sealed in the application
  ([ADR-0008](0008-access-code-encryption.md)). OAuth tokens are encrypted by Better Auth. Session
  tokens are stored as they are.

## Decision

**Two layers. Neon's history covers the last six hours. A nightly logical dump covers everything
older, and it is kept for 90 days outside both Neon and GitHub. Every dump is restored and checked
before it is kept.**

1. **The dump is taken as `capexwise_reader`.** It is a NOLOGIN role created by
   `drizzle/0007_backup_reader.sql`. It holds `select` on every table and nothing else. Every table
   with row security has one policy for it, `for select ... using (true)`. A login created by hand
   on production's branch, `capexwise_backup`, holds the role. The login is created with SQL, not
   in the Neon console, because the console adds its roles to Neon's administrative group, which
   brings `pg_write_all_data` with it. The reader bypasses nothing: it reads every row because a
   policy on each table says it may.
2. **Every backup is a restore drill.** `npm run db:backup` (`src/db/backup.mts`) does three things:
   - It counts every table in a transaction that exports its snapshot. `pg_dump` is then handed
     that same snapshot, so the counts and the dump agree to the row, even while people are writing.
   - It restores the dump into an empty Postgres 18 on the runner, with `--single-transaction` and
     `--exit-on-error`, and times the restore.
   - It compares the two sides: row counts, plus the row security, policies and grants on both. A
     restore that brought the rows back without its policies would be production with one of its
     two layers missing.

   A dump that fails any step is not uploaded. The run summary shows how long the dump and the
   restore took.
3. **It refuses to dump when the reader cannot see everything.** Both sides are read as the reader,
   so the comparison cannot catch a table whose policies hide rows from it. That table would dump
   empty, restore empty and match. So the command checks the catalog first, and refuses if any table
   with row security lacks a policy admitting the reader. The isolation test checks the same thing
   on every pull request.
4. **Encrypted with `age` to a public key.** The public key is a GitHub environment variable. The
   private key lives only in the password manager, beside production's `ACCESS_CODE_KEYS`.
   Decrypting is needed only to restore, so it never sits where the job can reach it.
5. **Stored in an S3-compatible bucket**, Backblaze B2 or Cloudflare R2, chosen by configuration
   rather than by code. The job's key can write and cannot delete: a Write Only key on B2, a bucket
   lock rule on R2. A lifecycle rule deletes each object 90 days after it is written.
6. **Kept 90 days.** That covers a mistake noticed at the end of a quarter.
7. **Three tables are backed up without their rows:** `sessions`, `verifications` and
   `rate_limits`. Their rows are worthless after a restore, and live session tokens do not belong in
   a file that outlives the incident that needed it. A restore signs everyone out.
8. **Nightly at 08:17 UTC**, the small hours in Indianapolis, and by hand before anything risky.
   `.github/workflows/backup.yml` runs it, with its credentials in a GitHub environment named
   `backups` whose branch rule allows only `main`. That environment is not `production`, so this job
   cannot read the migration credential and the migration job cannot read this one.

What the job prints is chosen for a public log. It shows timings and pass or fail per table, never
a row count, because a count of `organizations` is a count of customers.

`docs/runbooks/backup-and-restore.md` is the operational half: the setup, the restore procedures,
and the drills to run by hand.

## Alternatives considered

**Neon's own history and snapshots, and nothing else.** No work, and it is the right tool for the
first six hours, so it stays as the first layer. As the only layer it has three problems. The window
is six hours. More costs the Launch plan, which is a bill with no customers. And it is not
independent: an account suspended, a project deleted, or a provider incident takes the backups with
the database.

**`pg_dump` as the owner, with `--enable-row-security`.** It works today and is wrong on the day
the first domain table lands. Every domain table would dump empty, the restore would succeed, and
the counts would agree, because both would be read through the same policies. This decision rules
it out.

**A `BYPASSRLS` backup login.** It would dump everything without a policy per table, and it is
what `pg_dump`'s documentation assumes. It lost for ADR-0007's reasons. Creating one needs a role
that already has `BYPASSRLS`, which Neon's owner does not. And it would bypass every policy there
will ever be, where the reader's reach is written down table by table and tested.

**GitHub Actions artifacts instead of a bucket.** Nothing to set up. But retention is capped at 90
days, anyone with admin on the repository can delete them, and they live in the same account as the
code. From v0.5, any signed-in GitHub user could also download the ciphertext of production. A
bucket is storage we control, in the sense #35 meant.

**A restore drill run by hand every so often.** #35 asks for one restore, timed. Done once by hand,
it proves the backup of that day. Every later change, from a new role to a migration `pg_restore`
cannot replay, goes untested until the day it matters. A drill on every run costs about a minute of
runner time.

**Counting rows in a separate transaction from the dump.** Simpler, and flaky. One sign-in during
the backup would be a mismatch, and a nightly job that fails for no reason teaches everyone to ignore
it. The shared snapshot costs one flag.

**Keeping sessions in the backup.** A restore would then keep people signed in. But sessions last
days, and restoring them buys little. Keeping them puts live credentials into 90 days of files.

**A year of retention.** It would cover a mistake found at tax time. But a purged org's rows would
then outlive their deletion by more than a year. The privacy policy would have to say so, and a
retired access-code key would have to be kept for as long. 90 days can be lengthened later; data
already kept cannot be un-kept.

## Consequences

**What this makes easy.** Every backup has been restored once before it is kept, and the run page
says how long that took. A lost night is visible as a red run. GitHub emails the failure to whoever
last edited the schedule. Restoring from Neon's history within six hours is a console action, and
from a dump it is the runbook's procedure, which is the same `pg_restore` the drill runs every
night. Changing providers is four variables.

**What this makes hard.**

- **The per-table checklist grows by two lines.** A new table needs a `select` grant for
  `capexwise_reader`. A table with row security also needs its read policy. The isolation test
  refuses a table missing either, and the backup refuses to run against one in production.
- **The age key is a single point of failure.** Losing it loses every backup. That makes it the
  second secret in the password manager whose loss costs data rather than a sign-in, after
  `ACCESS_CODE_KEYS`. The nightly drill restores the dump before encryption, so it never proves the
  key decrypts what was uploaded. The runbook's quarterly drill does.
- **Restoring needs secrets as well as the dump.** Access codes open only under the
  `ACCESS_CODE_KEYS` version that sealed them. So a version retired by a rotation stays in the
  password manager for 90 days after it, the life of the last backup that needs it.
- **Deletion takes longer to finish.** A purged org's rows stay in backups for 90 days after the
  purge: 120 days from deletion in all, counting data-model §7's 30-day window. The privacy policy
  (#38) has to say so. ADR-0009's way back ends when the last of those expires.
- **The recovery point is a day** for anything older than Neon's six-hour window. A change made at
  noon and found two days later is lost back to the previous night's dump.
- **Scheduled workflows are best-effort.** GitHub can start them late. And in a public repository it
  disables them after 60 days without activity, which is v0.5's problem to watch.

**What it costs.** About a minute of runner time a night. For Neon, one wake-up a night, plus the
five minutes of idle compute before it suspends again: a few CU-hours a month from the free
plan's 100. The bucket is free at this size.

**Cost of reversal.** Low. The workflow and the script can be deleted. The role and its policies
are harmless without them, and a later migration can drop them. Moving to Neon's paid backups
instead is a plan change. What is expensive to reverse is the retention: data already kept cannot be
un-kept, so the window should be lengthened only deliberately.
