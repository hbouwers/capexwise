/**
 * Seals and opens building access codes. This is the only code in the
 * application that holds a code in plaintext, and ADR-0008 is the decision it
 * implements.
 *
 * **AES-256-GCM, in the application, through `node:crypto`.** The database
 * stores what `sealAccessCode` returns — `building_access_codes.secret` and
 * `key_version` — and never sees a code or a key. That is the reason this is not
 * `pgcrypto`: there, the code and the key are both bound parameters of the
 * query, and Drizzle's `DrizzleQueryError` prints every bound parameter in its
 * message. One insert that trips a constraint would write a code and the key
 * that protects every code into the server log.
 *
 * Four properties, each held by a test in `access-code-cipher.test.mts`:
 *
 * - **Bound to its org.** The org id is authenticated data, so a secret copied
 *   into another org's row does not open there. Row-level security keeps one
 *   org from reading another's rows; this keeps a row that has been moved from
 *   meaning anything.
 * - **Fixed length.** The code is padded to one 64-byte block before sealing,
 *   so every secret is `SEALED_BYTES` long and a dump does not give away how
 *   many digits a code has. That is the reason `MaskedValue`'s mask is a fixed
 *   width (`docs/ui/components.md` §9), and it would be odd to hide the length
 *   in the browser and publish it in the database.
 * - **A fresh IV every time**, so two buildings with the same gate code have
 *   different secrets. It also matters for more than privacy: GCM under one key
 *   with a repeated IV gives away the authentication key.
 * - **No error names a code, a key or a secret.** Messages say which key
 *   version and what went wrong, never a value. It is CLAUDE.md's rule about
 *   access codes, and it applies here more than anywhere else.
 *
 * The keyring is passed in rather than read here. `ACCESS_CODE_KEYS` is the
 * source (`src/lib/env-schema.mts` checks it at boot), and taking it as an
 * argument keeps this module framework-free: it is testable with no
 * environment, and a plain Node script such as the re-encryption job ADR-0008
 * describes can use it as it stands.
 *
 * `.mts`, with only `node:` imports, because `env-schema.mts` imports
 * `parseKeyring` from here, and the migration runner runs that under plain Node
 * with no bundler to resolve anything else.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * The padded plaintext: one length byte, the code's UTF-8, then zeros. 64 is
 * generous for what goes in this field. A smart-lock or keypad code is four to
 * eight digits, and a gate code with its `#` and `*` is not much longer.
 */
const BLOCK_BYTES = 64;

export const MAX_CODE_BYTES = BLOCK_BYTES - 1;

/**
 * The length of every sealed secret: IV, one encrypted block, tag. The schema
 * checks `octet_length(secret)` against this, so a plaintext written into the
 * column during a debug session is refused rather than stored
 * (`docs/data-model.md` §3).
 */
export const SEALED_BYTES = IV_BYTES + BLOCK_BYTES + TAG_BYTES;

export interface Keyring {
  /** The version `sealAccessCode` seals under, which is the highest present. */
  readonly current: number;
  readonly keys: ReadonlyMap<number, Buffer>;
}

export interface SealedAccessCode {
  readonly secret: Buffer;
  readonly keyVersion: number;
}

/**
 * Everything this module throws on purpose. It is a distinct class so that
 * `env-schema.mts` can turn a malformed keyring into a configuration error, and
 * so that a caller can tell a code that will not open from a bug.
 */
export class AccessCodeCipherError extends Error {
  override readonly name = "AccessCodeCipherError";
}

/**
 * One keyring entry. The version is a positive integer that fits in a Postgres
 * `integer`, with no leading zero, so that `1` and `01` cannot both be present.
 * The key is 32 bytes in unpadded base64url, which is 43 characters and is what
 * the command in `.env.example` prints.
 */
const ENTRY = /^([1-9][0-9]{0,8}):([A-Za-z0-9_-]{43})$/;

/**
 * Parses `ACCESS_CODE_KEYS`: comma-separated `<version>:<key>` entries, in any
 * order.
 *
 * The messages are written to follow "`ACCESS_CODE_KEYS` is invalid — it",
 * which is how `parseEnv` prints them at boot. They name entries by position,
 * never by content, because the content is the key.
 */
export function parseKeyring(value: string): Keyring {
  const entries = value.split(",");
  const keys = new Map<number, Buffer>();

  for (const [index, entry] of entries.entries()) {
    const match = ENTRY.exec(entry.trim());

    if (!match) {
      throw new AccessCodeCipherError(
        `must be comma-separated \`<version>:<key>\` entries, and entry ` +
          `${index + 1} of ${entries.length} is not one. A version is a ` +
          `positive whole number; a key is 32 random bytes in base64url, ` +
          `43 characters long`,
      );
    }

    const version = Number(match[1]);
    const key = Buffer.from(match[2]!, "base64url");

    if (keys.has(version)) {
      throw new AccessCodeCipherError(
        `must name each version once, and it names version ${version} twice`,
      );
    }

    // The one mistake a rotation is likely to make: a new version carrying the
    // old key, which looks like a rotation and rotates nothing.
    for (const [other, existing] of keys) {
      if (existing.equals(key)) {
        throw new AccessCodeCipherError(
          `must hold a different key under each version, and versions ` +
            `${other} and ${version} hold the same one`,
        );
      }
    }

    keys.set(version, key);
  }

  return { current: Math.max(...keys.keys()), keys };
}

export function sealAccessCode(
  keyring: Keyring,
  orgId: string,
  code: string,
): SealedAccessCode {
  const bytes = Buffer.from(code, "utf8");

  if (bytes.length === 0) {
    throw new AccessCodeCipherError("An access code cannot be empty.");
  }

  // Bytes, not characters: `€` is one character and three bytes.
  if (bytes.length > MAX_CODE_BYTES) {
    throw new AccessCodeCipherError(
      `An access code is at most ${MAX_CODE_BYTES} bytes of UTF-8.`,
    );
  }

  const block = Buffer.alloc(BLOCK_BYTES);
  block.writeUInt8(bytes.length, 0);
  bytes.copy(block, 1);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(
    ALGORITHM,
    keyring.keys.get(keyring.current)!,
    iv,
    { authTagLength: TAG_BYTES },
  );
  cipher.setAAD(associatedData(orgId));

  const sealed = Buffer.concat([cipher.update(block), cipher.final()]);

  return {
    secret: Buffer.concat([iv, sealed, cipher.getAuthTag()]),
    keyVersion: keyring.current,
  };
}

export function openAccessCode(
  keyring: Keyring,
  orgId: string,
  { secret, keyVersion }: SealedAccessCode,
): string {
  const aad = associatedData(orgId);

  if (secret.length !== SEALED_BYTES) {
    throw new AccessCodeCipherError(
      `A sealed access code is ${SEALED_BYTES} bytes, and this one is not, ` +
        `so \`sealAccessCode\` did not write it.`,
    );
  }

  const key = keyring.keys.get(keyVersion);

  if (!key) {
    throw new AccessCodeCipherError(
      `This access code was sealed under key version ${keyVersion}, which ` +
        `ACCESS_CODE_KEYS does not hold. A version leaves the keyring only ` +
        `when nothing sealed under it remains (ADR-0008), so either it was ` +
        `removed too early or this row came from another environment.`,
    );
  }

  // `authTagLength` on the decipher as well as the cipher. Without it, Node
  // accepts a tag shorter than 16 bytes, and a truncated tag is a weaker one. The
  // slice below is always 16 bytes, so this guards against a later change to
  // how the tag is taken, not against anything today.
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    secret.subarray(0, IV_BYTES),
    { authTagLength: TAG_BYTES },
  );
  decipher.setAAD(aad);
  decipher.setAuthTag(secret.subarray(IV_BYTES + BLOCK_BYTES));

  let block: Buffer;

  try {
    block = Buffer.concat([
      decipher.update(secret.subarray(IV_BYTES, IV_BYTES + BLOCK_BYTES)),
      decipher.final(),
    ]);
  } catch {
    // GCM gives one answer for all three causes, and so does this message.
    // The third is the one to expect: a Neon preview branch is a copy of
    // production, rows included, and preview's version 1 is a different key
    // from production's version 1.
    throw new AccessCodeCipherError(
      `This access code does not open under key version ${keyVersion} for ` +
        `this org. It was altered, it was sealed for a different org, or it ` +
        `was sealed in another environment under a different key with the ` +
        `same version number.`,
    );
  }

  return block.subarray(1, 1 + block.readUInt8(0)).toString("utf8");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What the tag authenticates besides the code: which column, and which org.
 * The column name keeps a secret from one encrypted column opening as another's
 * if a second one ever uses this keyring. ADR-0008 says a second column needs a
 * decision of its own, but the protection costs nothing.
 *
 * The UUID check is here so that a missing org fails loudly. Sealing for `""`
 * would work, and nothing could open the result, which is the sort of bug
 * found months later on the day someone needs the code.
 */
function associatedData(orgId: string): Buffer {
  if (!UUID.test(orgId)) {
    throw new AccessCodeCipherError(
      "An access code is sealed for an org, and the org id given is not a UUID.",
    );
  }

  return Buffer.from(
    `building_access_codes.secret:${orgId.toLowerCase()}`,
    "utf8",
  );
}
