# Backup and restore

The operational half of [ADR-0010](../adr/0010-backups.md): what exists, how to set it up once,
how to restore, and the drills to run by hand. The ADR explains the reasons. This file is the
steps.

## What exists

| Layer | Covers | Kept | Where |
| --- | --- | --- | --- |
| Neon's history | Any moment in the last 6 hours | 6 hours, rolling | The Neon project, branch `main` |
| The nightly dump | The database as it was at 08:17 UTC each day | 90 days | The backup bucket, under `nightly/`, encrypted |

Neon's free plan also includes one manual snapshot. Take one before anything you are nervous about,
on top of a nightly dump run by hand (below).

The nightly dump is [`.github/workflows/backup.yml`](../../.github/workflows/backup.yml) running
[`npm run db:backup`](../../src/db/backup.mts). Each run dumps production as `capexwise_backup`,
restores the dump into an empty Postgres on the runner, and compares the result with production:
every table's rows, plus the row security, policies and grants. Only then does it encrypt the dump
and upload it. The run's summary page shows how long the dump and the restore took.

A failed run sends an email to whoever last edited the workflow's schedule. Read the run's log
before anything else. A red run means that night's backup was **not** uploaded.

## Setup, once

Do these in order. The first run fails at its first step, naming everything still missing, until
the whole list is done.

### 1. The backup login

`drizzle/0007_backup_reader.sql` has to be applied to production first. The migrate job does that
when the pull request adding it merges.

Then, in the Neon console's **SQL editor**, on branch `main`, connected as the owner:

```sql
CREATE ROLE capexwise_backup LOGIN PASSWORD '<generated>' NOBYPASSRLS;
GRANT capexwise_reader TO capexwise_backup WITH INHERIT TRUE, SET FALSE;
```

Generate the password with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**Create it with SQL, not on the console's Roles page.** A role created there joins
`neon_superuser`, and through it `pg_write_all_data`: a backup login that can write everywhere.
`capexwise_app` was created with SQL for the same reason (README, "The database"). To check, both of
these should return `false`:

```sql
SELECT rolbypassrls FROM pg_roles WHERE rolname = 'capexwise_backup';
SELECT pg_has_role('capexwise_backup', 'neon_superuser', 'member');
```

The connection string uses **the direct endpoint**, the host without `-pooler` in it. `npm run
db:backup` refuses the pooled one. The Connect dialog's role list does not include a role created
with SQL, so build the string by hand: open the dialog with pooling off and any role selected, then
replace the role and password. A password from the command above needs no escaping.

```
postgresql://capexwise_backup:<password>@<direct host>/<database>?sslmode=require&channel_binding=require
```

### 2. The encryption key

Install [age](https://age-encryption.org) (`winget install FiloSottile.age` on Windows, `brew
install age` on macOS), then:

```bash
age-keygen -o capexwise-backup.key
```

It prints the public key, `age1…`, and writes the file to the folder the terminal is in. Only one
line of the file is secret, the one starting `AGE-SECRET-KEY-1`. The others are comments, and the
public key can be derived from that line again. So it fits in an ordinary password entry:

1. Save the `AGE-SECRET-KEY-1…` line in the password manager as the password of an entry named
   "CapExWise backup key", next to production's `ACCESS_CODE_KEYS`. Put the public key in its
   notes.
2. **Check the saved copy before deleting anything.** Paste it from the password manager into a new
   file, `check.key`, and run `age-keygen -y check.key`. It must print the same `age1…` public key.
   Pasting it into a terminal command instead would put it in the shell's history.
3. Delete both files.
4. Keep the public key for step 4.

**Losing this key loses every backup.** The nightly job never decrypts anything, so nothing would
notice a lost key until the day it is needed. The quarterly drill below is what catches it.

### 3. The bucket

**Backblaze B2 is the recommendation.** Its keys can be made write-only, and its free tier needs no
card. R2 works as well: the job speaks S3 to both, and which one it uses is only the four
variables in step 4. Whichever it is, the bucket needs three things:

- **Private.** The dumps are encrypted, but a list of dated objects is still nobody else's business.
- **A key limited to this one bucket, that can write and cannot delete.** If the job's credential
  leaks, it can add objects but not destroy the backups.
- **A lifecycle rule** that deletes each object 90 days after it is written. This is the retention
  ADR-0010 decided on. The job does not enforce it.

**Backblaze B2.** Choose the US East region when signing up, near Neon's `us-east-1`. The region
is fixed for the account. Create a private bucket. Under Lifecycle Settings, choose custom rules on
prefix `nightly/`: hide files 90 days after upload, and delete them one day after they are hidden.
Under Application Keys, add a key restricted to that bucket and to prefix `nightly/`, with **Write
Only** access. The endpoint is the bucket's S3 endpoint, `https://s3.<region>.backblazeb2.com`, and
the region is the `<region>` part of it.

**Cloudflare R2.** Create a bucket. Add an object lifecycle rule on prefix `nightly/` that deletes
objects after 90 days. Add a **bucket lock** rule on the same prefix with a 90-day retention period.
R2's tokens that can write can also delete, and the lock is what stops them. Create an API token
with Object Read & Write, scoped to that bucket. The endpoint is
`https://<account id>.r2.cloudflarestorage.com`, and the region is `auto`.

### 4. The GitHub environment

In GitHub: Settings → Environments → **New environment**, named `backups`. Add a deployment branch
rule limiting it to `main`. Then add:

| Name | Kind | Value |
| --- | --- | --- |
| `BACKUP_DATABASE_URL` | Secret | The connection string from step 1 |
| `BACKUP_S3_ACCESS_KEY_ID` | Secret | The key id from step 3 |
| `BACKUP_S3_SECRET_ACCESS_KEY` | Secret | The key's secret from step 3 |
| `BACKUP_S3_ENDPOINT` | Variable | The endpoint from step 3, with `https://` |
| `BACKUP_S3_REGION` | Variable | The region from step 3 |
| `BACKUP_S3_BUCKET` | Variable | The bucket's name |
| `BACKUP_AGE_RECIPIENT` | Variable | The public key from step 2, `age1…` |

### 5. The first run

Actions → **Backup** → Run workflow, on `main`. When it is green:

- The summary shows the dump and restore times, and says the restore matched.
- The bucket holds one object under `nightly/`.

Then do the quarterly drill below once, straight away. That is the first proof that the key in the
password manager opens what the job uploads, and it is the timed restore #35 asks for. Record it at
the bottom of this file.

## Restoring

Pick the smallest restore that fixes the problem, and **rehearse it on a copy before touching
production.**

### Something went wrong in the last six hours

Use Neon's history. In the Neon console, open the project's **Branches**, then branch `main`, then
**Restore**, and choose a moment before the mistake. Neon keeps the state it replaced as a backup
branch, so a restore to the wrong moment can itself be undone.

To look before you leap, create a new branch from `main` at a past moment instead, and query it.
That changes nothing in production.

### It is older than that

Restore a nightly dump. It holds every table in the `public` and `drizzle` schemas. `sessions`,
`verifications` and `rate_limits` come back empty, so everyone signs in again afterwards.

You need Postgres 18's client tools (`pg_restore`), `age`, and the key from the password manager.

1. **Download** the newest object from before the mistake, from the bucket's console.
2. **Decrypt** it. Put the key in a file only while you need it:

   ```bash
   age --decrypt --identity capexwise-backup.key --output capexwise.dump <downloaded>.dump.age
   rm capexwise-backup.key
   ```

   Keep `capexwise.dump` outside the repository. The parent working directory is outside git for
   exactly this kind of file.

3. **Prepare an empty database** as the restore target. For production that means a new database
   in the Neon project, or a new project if Neon itself is the problem. Never the database you are
   replacing, because the restore runs in one transaction and should land somewhere it cannot break
   anything. On a new server, first create the roles the dump's policies name (roles belong to the
   server, and a dump does not carry them):

   ```sql
   CREATE ROLE capexwise_scoped NOLOGIN NOBYPASSRLS;
   CREATE ROLE capexwise_identity NOLOGIN NOBYPASSRLS;
   CREATE ROLE capexwise_reader NOLOGIN NOBYPASSRLS;
   ```

4. **Restore** as the target's owner, over the direct endpoint:

   ```bash
   pg_restore --list capexwise.dump | grep -v -e " SCHEMA - public " -e " DEFAULT ACL " > capexwise.list
   pg_restore --dbname "<owner's direct connection string>" --no-password \
     --single-transaction --exit-on-error --no-owner --use-list capexwise.list capexwise.dump
   ```

   The first line removes two kinds of entry that fail against any target. One is the dump's
   `CREATE SCHEMA public`, because every database already has that schema. The other is Neon's
   default privileges, which it sets in every database as `cloud_admin` for `neon_superuser`. Only
   `cloud_admin` may set them again, and a new Neon database has its own. `npm run db:backup` does
   the same thing every night. Set the password in `PGPASSWORD` rather than in the string.

5. **Give the logins their roles on a new server.** On the same Neon branch they carry over. On a
   new one, the owner needs the two memberships the migrations give the role that runs them.
   `capexwise_app` and `capexwise_backup` are recreated as in #81 and step 1 above:

   ```sql
   GRANT capexwise_scoped TO <owner> WITH INHERIT FALSE, SET TRUE;
   GRANT capexwise_identity TO <owner> WITH INHERIT TRUE, SET FALSE;
   ```

6. **Catch up the schema.** Point `PRODUCTION_DATABASE_URL` at the restored database and let the
   migrate job run. It applies only the migrations newer than the dump, because the dump carries
   Drizzle's own record of which it has had.
7. **Switch production over.** Update Vercel's `DATABASE_URL` (README, "The database"), and
   `BACKUP_DATABASE_URL` in the `backups` environment. Then redeploy production, because Vercel
   applies an environment change only to deployments built after it.

**Access codes open only with the key that sealed them.** The restored rows need production's
`ACCESS_CODE_KEYS`, including any version retired in the last 90 days, from the password manager
([ADR-0008](../adr/0008-access-code-encryption.md)).

### One org, not the whole database

This is not a database restore ([ADR-0003](../adr/0003-multi-tenancy.md)). Restore the dump into a
scratch database as above. Then copy that org's rows across by hand, and review each statement as
you would a data migration, until export (#45) exists.

## Drills

**Every night, automatically**: dump, restore, compare, timed. There is nothing to do but read a
red run.

**Every quarter, and after any change to the key**: the half the nightly job cannot do, which is
proving the key in the password manager opens what was uploaded.

1. Download the newest object and decrypt it, as in "It is older than that", steps 1 and 2.
2. Restore it into the local compose database, into a database created for it:

   ```bash
   npm run db:up
   docker exec capexwise-postgres createdb -U capexwise capexwise_restore
   ```

   Then run step 4 with `postgresql://capexwise@127.0.0.1:5432/capexwise_restore` as the connection
   string and `PGPASSWORD=capexwise_local_dev`. The compose database already has the roles, from its
   own migrations.

3. Check that the row counts look right, then drop the database and delete the files.
4. Add a line below.

**To run the nightly command locally** (with Postgres 18's `pg_dump` and `pg_restore` on the
PATH), point it at the compose database. As the compose superuser it reads past every policy, and
the restore check runs as normal:

```bash
BACKUP_SOURCE_URL=postgresql://capexwise:capexwise_local_dev@127.0.0.1:5432/capexwise \
BACKUP_RESTORE_URL=postgresql://capexwise:capexwise_local_dev@127.0.0.1:5432/capexwise_restore \
npm run db:backup -- ../capexwise.dump
```

## Drill log

| Date | Drill | Source | Dump | Restore | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-09-11 | `db:backup`, before the first nightly run | Local compose database, two seeded orgs, logged in as a `capexwise_backup` login | 0.1 s | 0.1 s | Matched on all 9 tables. With one read policy dropped, it refused to dump. The full decrypt-and-restore drill is still to do, after setup |
