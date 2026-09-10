/**
 * The access-code cipher, tested for what ADR-0008 promises about it: a code
 * comes back out, it comes back out only for its own org and only under a key
 * this environment holds, the database learns nothing from the length, and no
 * failure puts a code, a key or a secret into a message that ends up in a log.
 */
import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  AccessCodeCipherError,
  MAX_CODE_BYTES,
  openAccessCode,
  parseKeyring,
  SEALED_BYTES,
  sealAccessCode,
} from "@/lib/access-code-cipher.mts";

const ORG = "01926f3a-7c1e-7d4b-9a2f-3c5e8b1d4f60";
const OTHER_ORG = "01926f3a-7c1e-7d4b-9a2f-3c5e8b1d4f61";

function key(): string {
  return randomBytes(32).toString("base64url");
}

const V1 = key();
const V2 = key();

const keyring = parseKeyring(`1:${V1}`);
const rotated = parseKeyring(`2:${V2},1:${V1}`);

/**
 * Runs `fn`, which must throw an `AccessCodeCipherError`, and returns the
 * message. The leak checks below then run over every message this module can
 * produce.
 */
function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AccessCodeCipherError);

    return (error as Error).message;
  }

  return expect.unreachable("expected an AccessCodeCipherError");
}

describe("sealAccessCode and openAccessCode", () => {
  it("opens what it sealed", () => {
    for (const code of ["4417#", "2280", "*0915#", "Gate: 1234 then #"]) {
      const sealed = sealAccessCode(keyring, ORG, code);

      expect(openAccessCode(keyring, ORG, sealed)).toBe(code);
    }
  });

  it("round-trips a code that is not ASCII, at the maximum length", () => {
    // 21 × "€" is 63 bytes and 21 characters: the limit is counted in bytes,
    // and a length prefix that counted characters would cut this short.
    const code = "€".repeat(MAX_CODE_BYTES / 3);

    expect(
      openAccessCode(keyring, ORG, sealAccessCode(keyring, ORG, code)),
    ).toBe(code);
  });

  it("seals every code to the same length", () => {
    // The fixed-width mask in `MaskedValue` hides the length in the browser;
    // this hides it in a dump. It is also the number the schema's
    // `octet_length(secret)` check is written against.
    const short = sealAccessCode(keyring, ORG, "1");
    const long = sealAccessCode(keyring, ORG, "9".repeat(MAX_CODE_BYTES));

    expect(short.secret.length).toBe(SEALED_BYTES);
    expect(long.secret.length).toBe(SEALED_BYTES);
    expect(SEALED_BYTES).toBe(92);
  });

  it("never seals the same code to the same secret twice", () => {
    // A fixed or counter-derived IV would make this fail, and under GCM a
    // repeated IV gives away the authentication key rather than merely
    // revealing that two buildings share a gate code.
    const first = sealAccessCode(keyring, ORG, "2280");
    const second = sealAccessCode(keyring, ORG, "2280");

    expect(first.secret.equals(second.secret)).toBe(false);
  });

  it("refuses an empty code, and one over the limit in bytes", () => {
    expect(() => sealAccessCode(keyring, ORG, "")).toThrow(
      AccessCodeCipherError,
    );

    // 22 characters, 66 bytes.
    expect(() => sealAccessCode(keyring, ORG, "€".repeat(22))).toThrow(
      /at most 63 bytes/,
    );
  });

  it("refuses to seal without an org", () => {
    // Sealing for "" would succeed, and nothing could ever open the result.
    expect(() => sealAccessCode(keyring, "", "2280")).toThrow(/not a UUID/);
  });

  it("treats the org id case-insensitively", () => {
    // Postgres hands a uuid back in lower case. An id that took a trip through
    // something that upper-cases it is still the same org.
    const sealed = sealAccessCode(keyring, ORG.toUpperCase(), "2280");

    expect(openAccessCode(keyring, ORG, sealed)).toBe("2280");
  });
});

describe("what does not open", () => {
  it("does not open for another org", () => {
    // The tenancy property. RLS stops org B reading org A's row; this is the
    // case where the secret has been copied into org B's row anyway.
    const sealed = sealAccessCode(keyring, ORG, "4417#");

    expect(() => openAccessCode(keyring, OTHER_ORG, sealed)).toThrow(
      /does not open under key version 1/,
    );
  });

  it("does not open a secret that has been altered", () => {
    const sealed = sealAccessCode(keyring, ORG, "4417#");

    for (const at of [0, 12, SEALED_BYTES - 1]) {
      const secret = Buffer.from(sealed.secret);
      secret[at]! ^= 0x01;

      expect(() => openAccessCode(keyring, ORG, { ...sealed, secret })).toThrow(
        AccessCodeCipherError,
      );
    }
  });

  it("does not open under a different key with the same version number", () => {
    // The preview-branch case: a copy of production's rows, and this
    // environment's own version 1.
    const sealed = sealAccessCode(keyring, ORG, "4417#");
    const elsewhere = parseKeyring(`1:${key()}`);

    expect(() => openAccessCode(elsewhere, ORG, sealed)).toThrow(
      /another environment/,
    );
  });

  it("names the version it does not hold", () => {
    const sealed = sealAccessCode(rotated, ORG, "4417#");

    expect(() => openAccessCode(keyring, ORG, sealed)).toThrow(
      /key version 2, which ACCESS_CODE_KEYS does not hold/,
    );
  });

  it("refuses a value that is the wrong length to be a secret", () => {
    // The shape a plaintext has, if one reached the column despite the check.
    const secret = Buffer.from("4417#", "utf8");

    expect(() =>
      openAccessCode(keyring, ORG, { secret, keyVersion: 1 }),
    ).toThrow(/did not write it/);
  });
});

describe("rotation", () => {
  it("seals under the highest version, whatever order they are listed in", () => {
    expect(sealAccessCode(rotated, ORG, "2280").keyVersion).toBe(2);
    expect(
      sealAccessCode(parseKeyring(`1:${V1},2:${V2}`), ORG, "2280").keyVersion,
    ).toBe(2);
  });

  it("still opens what the previous version sealed", () => {
    // The state between steps 1 and 3 of ADR-0008's rotation: the new key is
    // sealing, and the rows the old one sealed are not yet re-sealed.
    const old = sealAccessCode(keyring, ORG, "4417#");

    expect(old.keyVersion).toBe(1);
    expect(openAccessCode(rotated, ORG, old)).toBe("4417#");
  });
});

describe("parseKeyring", () => {
  it("accepts one entry, or several with space around the commas", () => {
    expect(parseKeyring(`1:${V1}`).current).toBe(1);
    expect(parseKeyring(`2:${V2} , 1:${V1}`).keys.size).toBe(2);
  });

  it("decodes each key to 32 bytes", () => {
    expect(parseKeyring(`1:${V1}`).keys.get(1)).toHaveLength(32);
  });

  it("refuses entries that are not <version>:<key>", () => {
    for (const value of [
      V1, // no version
      `0:${V1}`, // not positive
      `01:${V1}`, // leading zero
      `v1:${V1}`,
      `1:${V1.slice(1)}`, // 31-and-a-bit bytes
      `1:${V1}A`, // too long
      `1:${randomBytes(32).toString("base64")}`, // padded, not base64url
      `1:${V1},`, // a trailing comma
    ]) {
      expect(() => parseKeyring(value)).toThrow(/is not one/);
    }
  });

  it("refuses a version named twice", () => {
    expect(() => parseKeyring(`1:${V1},1:${V2}`)).toThrow(
      /names version 1 twice/,
    );
  });

  it("refuses the same key under two versions", () => {
    // A rotation that copied the old key into the new version.
    expect(() => parseKeyring(`2:${V1},1:${V1}`)).toThrow(
      /versions 2 and 1 hold the same one/,
    );
  });
});

describe("what it must never print", () => {
  it("puts no code, key or secret in any message", () => {
    const code = "4417#";
    const sealed = sealAccessCode(keyring, ORG, code);
    const tampered = Buffer.from(sealed.secret);
    tampered[20]! ^= 0x01;

    const messages = [
      messageOf(() => openAccessCode(keyring, OTHER_ORG, sealed)),
      messageOf(() =>
        openAccessCode(keyring, ORG, { ...sealed, secret: tampered }),
      ),
      messageOf(() =>
        openAccessCode(keyring, ORG, { ...sealed, keyVersion: 7 }),
      ),
      messageOf(() =>
        openAccessCode(keyring, ORG, {
          secret: Buffer.from(code),
          keyVersion: 1,
        }),
      ),
      messageOf(() => sealAccessCode(keyring, ORG, code.repeat(20))),
      messageOf(() => parseKeyring(`1:${V1},x:${V2}`)),
      messageOf(() => parseKeyring(`1:${V1},1:${V2}`)),
      messageOf(() => parseKeyring(`2:${V1},1:${V1}`)),
    ];

    const forbidden = [
      code,
      V1,
      V2,
      sealed.secret.toString("hex"),
      sealed.secret.toString("base64"),
      sealed.secret.toString("base64url"),
    ];

    for (const message of messages) {
      for (const value of forbidden) {
        expect(message).not.toContain(value);
      }
    }
  });
});
