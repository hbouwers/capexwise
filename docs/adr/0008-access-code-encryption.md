# ADR-0008: Access codes — sealed in the application, keyed per environment

**Status:** Proposed — accepted on merge of the PR that adds it
**Date:** 2026-09-10
**Decided by:** Holden

## Context

The building facts card holds the codes that open buildings: the smart lock, the front door, the
lockbox, the garage, the gate. PRD §11 says they are sensitive, encrypted at rest and masked by
default. [`docs/data-model.md`](../data-model.md) §3 has already settled where they live:
`building_access_codes`, one row per code, `secret bytea` and `key_version` per row, and a hard
delete. #31 was left to decide the scheme, the key management, and whether utility `account_ref`
joins it.

**"Encrypted at rest" has to mean more than the disk.** Neon already encrypts its storage, which
protects against someone walking off with a drive. The copies this project actually makes are
logical ones, and disk encryption does nothing for them:

- **A Neon preview branch** is created for every pull request, and it is a copy of production, rows
  included (#33).
- **A dump or a backup restore** (#35).
- **The Neon console's SQL editor**, open to whoever holds the account.
- **A log line.** Drizzle 0.45's `DrizzleQueryError` has the message
  `Failed query: <sql>\nparams: <every bound parameter>`, and Next.js logs a server error that
  nothing caught. Anything that is a bound parameter of a query that fails ends up in the log.

The requirement is that none of these yields a code.

There is not much data, and that settles several costs. An org has tens of codes, not thousands, so
re-encrypting every row is seconds of work. Vercel has no key management service; Cloud Run, the
escape hatch in [ADR-0002](0002-hosting.md), would.

## Decision

**AES-256-GCM in the application, with a versioned keyring from the environment.**
`src/lib/access-code-cipher.mts` is the implementation. It is the only code that holds a code in
plaintext.

- **The scheme.** AES-256-GCM through `node:crypto`, with a random 96-bit IV for every seal and a
  128-bit tag. `secret` holds the IV, the ciphertext and the tag in that order. `key_version`
  records which key sealed it.
- **Bound to the org.** The tag also covers the column's name and the org's id, as additional
  authenticated data. A secret copied into another org's row does not open there. Row-level
  security keeps one org from reading another's rows, and this keeps a row that has been moved from
  meaning anything.
- **Fixed length.** A code is padded to one 64-byte block before it is sealed, so every secret is
  92 bytes, and a dump does not reveal how many digits a code has. That is the same reason
  `MaskedValue`'s mask is a fixed width ([components](../ui/components.md) §9). A code can be up to
  63 bytes of UTF-8.
- **The schema checks the shape**: `check (octet_length(secret) = 92)` and
  `check (key_version > 0)`. A plaintext written into the column during a debug session is refused
  rather than stored, which puts §3's reason for `bytea` into the schema.

**Keys.** `ACCESS_CODE_KEYS` is a list of `<version>:<key>` entries separated by commas. Each key is
32 random bytes in base64url. The highest version seals, and every version listed can open.
`src/lib/env-schema.mts` checks it at boot using the cipher's own parser.

It is **required from this ADR's pull request**, before any table holds a code. Adding it with the
first code would make the building-facts deploy the first time three environments all needed a new
secret, all at once.

| Environment | Where the keyring lives |
| --- | --- |
| Local | `.env.local`, generated once per machine |
| CI, compose, the integration suite | Committed throwaway values, each of which decodes to a phrase saying what it is. Nothing there seals a real code |
| Preview | Vercel, Preview scope, with its own value |
| Production | Vercel, Production scope, marked Sensitive. **The master copy is in the password manager**, because Vercel will not show a Sensitive value again |

Preview's key being its own is the point, not a formality. A preview branch holds production's rows,
so a preview deployment holding production's key could reveal every production code from a URL that
exists for code review. With its own key, the reveal fails with the error that names this case.
Version numbers restart in every environment, so preview's version 1 and production's version 1 are
different keys.

**Rotation** has no calendar. It happens when a key may have been exposed, or when the scheme
changes.

1. Generate version *n+1*. Set the keyring to `n+1:<new>,n:<old>` and redeploy. Vercel applies an
   environment change only to deployments built after it. New codes are now sealed under *n+1*, and
   old ones still open.
2. Re-seal every row still under *n* or earlier. The job does this one org at a time: the identity
   path lists the orgs, and each org's rows are read and re-sealed through that org's `forOrg()`,
   so the job needs no way around row-level security. It ships with the table, so that rotating
   after a leak is an operation rather than a development task.
3. Confirm nothing is left under *n*, using the same job's per-org count. **Not with a count in the
   Neon console**: the owner is subject to `FORCE` and has no policy on this table, so it counts
   zero rows whatever is there ([ADR-0007](0007-database-roles.md)).
4. Remove *n* from the keyring and redeploy. Keep *n* in the password manager until the last backup
   holding rows sealed under it has expired (#35).

Rotation does not undo a leak. A leaked key plus any copy of the database made before the rotation
reveals every code in that copy, and re-sealing protects only the copies made after it. The response
to a known leak is to rotate **and** change the codes at the locks.

**The read path.**

- The facts card's query names its columns and never selects `secret`. The page carries each code's
  id, kind and label, and `MaskedValue` renders a fixed-width mask. No plaintext and no ciphertext
  reaches the browser until someone asks.
- A reveal is a server action for one value ([components](../ui/components.md) §9, items 6 and 7).
  It calls `getOrgContext()`, reads that row's `secret` and `key_version` through the scoped handle,
  opens it with the org's id, and returns the one plaintext. The plaintext exists in the action's
  memory and in its response. It is not in the page, not in a cache, and not in a log.
- Writes seal before they query, so a failed insert can only ever print ciphertext.

**Every reveal is recorded, whatever the size of the org.** #31 leaned towards recording reveals only
once an org has a second member. That lost because a record that starts when a second person arrives
is missing exactly the history their arrival makes worth having, and recording a one-person org
costs a row per reveal. The record is who revealed, which code, in which org, and when. It never
includes the value.

Until `audit_log` exists (#42), the record is a structured server log line. #42 turns it into a row
written in the same transaction as the read, so that a reveal which cannot be recorded does not
happen. Adding a code and deleting one are recorded the same way, as §7 of the data model already
expects.

Every member who can see a building can reveal its codes. The first member who is not the owner
arrives with invites (#30), and a narrower rule arrives with them.

**Scope: access codes only.** `building_utilities.account_ref` stays plaintext, because it is a stub
by design: the last four characters, which a utility prints on every bill. The schema now enforces
that with `check (char_length(account_ref) <= 4)`, so a full account number is refused rather than
stored. That puts the custody rule in the schema, where CLAUDE.md puts it for SSNs. Any other column
that needs sealing gets its own decision. Because the tag covers the column's name, sharing this
keyring would be safe, but it would tie two rotations together.

## Alternatives considered

**`pgcrypto`.** `pgp_sym_encrypt(code, key)` in SQL is simpler to call, and it lost because of the
parameters. Both the code and the key would be bound parameters of every write and every reveal.
`DrizzleQueryError` prints every bound parameter, so one insert that trips a foreign key or a
row-level `WITH CHECK` writes a code to the log, along with the key that opens every code. The
provider's own statement logging, such as a slow-query log or `auto_explain`, would be a second copy,
in logs this project does not control. It would also send the key to the database, the one place the
key most needs to stay away from: the aim is that someone holding the database alone gets nothing.
And `pgp_sym_*` is OpenPGP with a passphrase-to-key step, which is more machinery for the same AES.

**Envelope encryption: a data key per org, wrapped by a key-encryption key.** This is what #31
named, and it is the right shape once there is a KMS. Its benefits are cheap rotation (re-wrap a few
data keys instead of re-encrypting every row) and crypto-shredding. Neither pays here:

- Re-encrypting every row takes seconds, so cheap rotation saves nothing.
- Crypto-shredding needs the data keys kept somewhere the backups are not. A wrapped data key in the
  same database is in the same backup.
- Without a KMS, the key-encryption key is an environment variable, just as this key is. An attacker
  needs the same two things either way, and the design adds a table and a key hierarchy.

Revisit on Cloud Run. There, a KMS can hold the key-encryption key and never release it: the
application asks the KMS to unwrap a data key and never holds the root, which is a real reduction.
`key_version` is what makes that move additive rather than a rewrite.

**A managed KMS now**, AWS KMS or Google Cloud KMS called from Vercel. It needs a cloud account and
a long-lived credential for it in the environment, so an environment variable is still the root of
the chain. It also adds a network round trip to every seal and every reveal. It is right at v1 on
Cloud Run, not before.

**Deriving the key from `BETTER_AUTH_SECRET` with HKDF.** One fewer secret per environment, but it
ties together two lifecycles that must stay separate. Rotating the auth secret is the response to a
session-forgery leak, and it should cost everyone a sign-in, not every access code. The reverse
holds too.

**Relying on the provider's disk encryption.** It is already true of Neon, and it covers a stolen
drive. Every logical copy (a branch, a dump, a restore, the SQL editor) reads plaintext through it,
so it does not meet what the PRD asks for.

**A column grant that keeps `secret` from the scoped role**, with a security-definer function for the
reveal. That would turn "the facts card never selects the ciphertext" from a convention into a
database rule. It lost on what it protects: the ciphertext is useless without the key, which the
database never holds. A definer function would also be a hole in ADR-0007's rule that the scoped
role reads what its org owns and nothing else.

## Consequences

**What this makes easy.** The database never holds a code or a key, so a branch, a dump, the SQL
editor or a failed query's log line shows only ciphertext. A preview cannot reveal production's
codes. A secret moved from one org to another does not open. Every secret is the same length, and
a plaintext in the column is a constraint violation. The cipher has no dependencies beyond Node, and
its unit tests need no environment.

**What this makes hard.** Every environment has one more secret. In production it is the only
secret whose loss costs data rather than a sign-in, which is why the password manager holds a copy.
Codes cannot be searched, sorted or compared in SQL; nothing needs to, and it is the point. Looking
at a code while debugging means going through the application. Rotation is a procedure with a job
behind it, not a toggle. A key retired by a rotation has to outlive the backups that need it, which
ties this ADR to #35's retention.

The limit, stated plainly: **the application server holds the key.** Anyone who can run code inside
it, or read Vercel's environment, and can also reach the database, can read every code. This ADR
protects the database's copies. It does not protect against a compromised application, and a KMS on
Cloud Run is what would narrow that.

**Cost of reversal.** Low, and it stays low because the table stays small. A different scheme is a
new key version under the new algorithm and one run of the re-seal job. `key_version` is per row, so
old and new can both be read while the move is under way.

## Sources

- Drizzle ORM 0.45.2, `errors.js`: `DrizzleQueryError` builds its message from the query text and
  every bound parameter. Checked against the installed package on 2026-09-10
- Node.js `crypto` documentation, `createDecipheriv`: `authTagLength` restricts which tag lengths a
  GCM decipher accepts
- NIST SP 800-38D, *Galois/Counter Mode*: the 96-bit IV, and the consequences of repeating an IV
  under one key
