/**
 * The two things the access-code paths need from the server beyond the
 * database: the keyring that seals and opens a code, and the record that one
 * was revealed, added, replaced or removed. ADR-0008 is the decision behind
 * both.
 */
import "server-only";

import { type Keyring, parseKeyring } from "@/lib/access-code-cipher.mts";
import { logEvent } from "@/lib/log";
import { env } from "@/server/env";

let parsed: Keyring | undefined;

/**
 * `ACCESS_CODE_KEYS`, parsed once. `src/lib/env-schema.mts` has already run
 * the same parser at boot, so a malformed keyring stopped the server long
 * before this.
 */
export function keyring(): Keyring {
  parsed ??= parseKeyring(env().ACCESS_CODE_KEYS);

  return parsed;
}

export type AccessCodeEvent =
  "revealed" | "reveal_failed" | "added" | "replaced" | "removed";

/**
 * Records that something happened to a code: who, which code, in which org and
 * building, and when. **Never the value, and never the label** — a record that
 * named the back door would be a map to it. ADR-0008 records every reveal,
 * whatever the size of the org, and adding and removing a code the same way.
 *
 * One structured line on the server's log until `audit_log` exists (#42),
 * which turns this into a row written in the same transaction as the read —
 * so that a reveal that cannot be recorded does not happen. Until then the
 * line is written before a revealed code is returned, and after a save has
 * committed, so the log describes what happened and not what was attempted.
 *
 * The line goes through `logEvent()` (ADR-0013), which is where the envelope
 * and the scrubbing now live. This function was the first instance of that
 * pattern and is why the envelope has the shape it does; what it still owns is
 * the list of fields — ids and an enum, no value and no label.
 */
export function recordAccessCodeEvent(entry: {
  event: AccessCodeEvent;
  orgId: string;
  userId: string;
  accessCodeId: string;
  buildingId: string;
}): void {
  logEvent({
    log: "access_code",
    orgId: entry.orgId,
    fields: {
      event: entry.event,
      user_id: entry.userId,
      access_code_id: entry.accessCodeId,
      building_id: entry.buildingId,
    },
  });
}
