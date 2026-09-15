"use server";

/**
 * The facts card's writes and its one read that is not a render
 * (`docs/ui/screens/building-detail.md`, Building facts): saving the editor,
 * and revealing one code. Both start with `getOrgContext()`, so the org is the
 * session's; every id the browser sends — a building, a unit, a contact, a
 * code — is looked up inside that org rather than trusted.
 *
 * **A code's plaintext goes as far as the cipher and no further.** The save
 * seals every new or replaced code before it opens a transaction, so the
 * values any query is sent — and that a failed query's error would print
 * (ADR-0008) — are ciphertext. The reveal opens one row's secret and returns
 * the result, and the plaintext is in the action's memory and its response,
 * not in a log or a cache. A failed write is caught and re-thrown with its
 * SQLSTATE only, as the contact actions do, because the rest of a utility row
 * is other people's details.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
  buildingAccessCodes,
  buildingFacts,
  buildings,
  buildingUtilities,
  contacts,
  units,
} from "@/db/schema";
import {
  AccessCodeCipherError,
  openAccessCode,
  sealAccessCode,
} from "@/lib/access-code-cipher.mts";
import {
  type UtilityValues,
  validateBuildingFacts,
} from "@/lib/building-facts-form";
import { type FieldErrors, UNREADABLE_FORM } from "@/lib/forms";
import { sqlState, withoutParameters } from "@/lib/query-errors";
import {
  type AccessCodeEvent,
  keyring,
  recordAccessCodeEvent,
} from "@/server/access-codes";
import { getOrgContext } from "@/server/org-context";

export type SaveBuildingFactsResult =
  { ok: true } | { ok: false; errors: FieldErrors };

export type RevealAccessCodeResult = { ok: true; code: string } | { ok: false };

/** The building actions' words, for the same reason: one 404 for both cases. */
const NOT_FOUND =
  "This building could not be found. It may have been removed, or it may be in another organization.";

/** A reference to a row that is not there, or not this org's. */
const FOREIGN_KEY_VIOLATION = "23503";

const idSchema = z.uuid();

function refused(message: string): SaveBuildingFactsResult {
  return { ok: false, errors: { form: message } };
}

function utilityColumns(utility: UtilityValues) {
  return {
    kind: utility.kind,
    unitId: utility.unitId,
    providerName: utility.providerName,
    accountRef: utility.accountRef,
    paidBy: utility.paidBy,
    avgMonthlyCents: utility.avgMonthlyCents,
    contactId: utility.contactId,
  };
}

/** The ids of the rows among `rows` that are already stored, in order. */
function storedIds(rows: readonly { id: string | null }[]): string[] {
  return rows.flatMap((row) => (row.id === null ? [] : [row.id]));
}

/**
 * Whether every id in `ids` is one of `known`, and none is there twice. A
 * stored row named twice would be edited twice from one save, and one that is
 * not this building's is a row the editor could not have shown.
 */
function allKnown(ids: readonly string[], known: ReadonlySet<string>): boolean {
  return new Set(ids).size === ids.length && ids.every((id) => known.has(id));
}

/**
 * The editor's save: the collection days, and the building's utilities and
 * codes made to match what was submitted — a row with an id is that row,
 * edited; a row without one is new; a stored row missing from the submission
 * was removed. The building form's reconciliation, and for its reason.
 *
 * An existing code with no new code typed keeps its secret. One with a new
 * code is re-sealed, and `last_rotated_at` records that the code at the lock
 * changed. Every code added, replaced or removed is recorded once the save
 * has committed (ADR-0008), and never its value.
 */
export async function saveBuildingFacts(
  buildingId: unknown,
  input: unknown,
): Promise<SaveBuildingFactsResult> {
  const { db, user } = await getOrgContext();

  const id = idSchema.safeParse(buildingId);
  if (!id.success) return refused(NOT_FOUND);

  const validated = validateBuildingFacts(input);
  if (!validated.ok) return validated;

  const { accessCodes, utilities, ...days } = validated.values;

  // Sealed here, before any query, and the plaintext is dropped with the
  // destructuring: nothing below this line can hand a code to the database.
  const codes = accessCodes.map(({ code, ...row }) => ({
    ...row,
    sealed: code === null ? null : sealAccessCode(keyring(), db.orgId, code),
  }));

  const events: { event: AccessCodeEvent; accessCodeId: string }[] = [];

  let result: SaveBuildingFactsResult;

  try {
    result = await db.run(async (tx): Promise<SaveBuildingFactsResult> => {
      // `for update`, as the building form's save does: this save and a
      // unit's removal serialise here, so neither checks the units against a
      // list the other has changed.
      const [building] = await tx
        .select({ id: buildings.id })
        .from(buildings)
        .where(and(eq(buildings.orgId, db.orgId), eq(buildings.id, id.data)))
        .for("update");

      if (!building) return refused(NOT_FOUND);

      const unitRows = await tx
        .select({ id: units.id })
        .from(units)
        .where(
          and(eq(units.orgId, db.orgId), eq(units.buildingId, building.id)),
        );
      const utilityRows = await tx
        .select({ id: buildingUtilities.id })
        .from(buildingUtilities)
        .where(
          and(
            eq(buildingUtilities.orgId, db.orgId),
            eq(buildingUtilities.buildingId, building.id),
          ),
        );
      const codeRows = await tx
        .select({ id: buildingAccessCodes.id })
        .from(buildingAccessCodes)
        .where(
          and(
            eq(buildingAccessCodes.orgId, db.orgId),
            eq(buildingAccessCodes.buildingId, building.id),
          ),
        );

      const contactIds = [
        ...new Set(
          utilities.flatMap((u) => (u.contactId ? [u.contactId] : [])),
        ),
      ];
      const contactRows =
        contactIds.length === 0
          ? []
          : await tx
              .select({ id: contacts.id })
              .from(contacts)
              .where(
                and(
                  eq(contacts.orgId, db.orgId),
                  inArray(contacts.id, contactIds),
                ),
              );

      const unitIds = new Set(unitRows.map((row) => row.id));
      const scoped = [...codes, ...utilities].flatMap((row) =>
        row.unitId === null ? [] : [row.unitId],
      );

      // Everything the browser named, looked up in this building and this
      // org. One that is not there refuses the whole save before anything is
      // written — the building form's rule, because a save that quietly
      // skipped a row would look like it worked.
      if (
        !scoped.every((unitId) => unitIds.has(unitId)) ||
        !allKnown(storedIds(codes), new Set(codeRows.map((row) => row.id))) ||
        !allKnown(
          storedIds(utilities),
          new Set(utilityRows.map((row) => row.id)),
        ) ||
        contactRows.length !== contactIds.length ||
        codes.some((code) => code.id === null && code.sealed === null)
      ) {
        return refused(UNREADABLE_FORM);
      }

      // One row per building, written the first time a day is recorded.
      // Clearing every field afterwards is an update to nothing, not a
      // delete, which the scoped role is not granted.
      if (Object.values(days).every((value) => value === null)) {
        await tx
          .update(buildingFacts)
          .set(days)
          .where(
            and(
              eq(buildingFacts.orgId, db.orgId),
              eq(buildingFacts.buildingId, building.id),
            ),
          );
      } else {
        await tx
          .insert(buildingFacts)
          .values({ orgId: db.orgId, buildingId: building.id, ...days })
          .onConflictDoUpdate({
            target: [buildingFacts.orgId, buildingFacts.buildingId],
            set: days,
          });
      }

      const keptUtilities = new Set(storedIds(utilities));
      const removedUtilities = utilityRows
        .map((row) => row.id)
        .filter((utilityId) => !keptUtilities.has(utilityId));
      if (removedUtilities.length > 0) {
        await tx
          .delete(buildingUtilities)
          .where(
            and(
              eq(buildingUtilities.orgId, db.orgId),
              inArray(buildingUtilities.id, removedUtilities),
            ),
          );
      }

      for (const utility of utilities) {
        if (utility.id === null) continue;

        await tx
          .update(buildingUtilities)
          .set(utilityColumns(utility))
          .where(
            and(
              eq(buildingUtilities.orgId, db.orgId),
              eq(buildingUtilities.id, utility.id),
            ),
          );
      }

      const addedUtilities = utilities.filter((u) => u.id === null);
      if (addedUtilities.length > 0) {
        await tx.insert(buildingUtilities).values(
          addedUtilities.map((utility) => ({
            orgId: db.orgId,
            buildingId: building.id,
            ...utilityColumns(utility),
          })),
        );
      }

      // Removed codes are hard-deleted (§7): no ciphertext is kept for a
      // lock that has been rekeyed.
      const keptCodes = new Set(storedIds(codes));
      const removedCodes = codeRows
        .map((row) => row.id)
        .filter((codeId) => !keptCodes.has(codeId));
      if (removedCodes.length > 0) {
        await tx
          .delete(buildingAccessCodes)
          .where(
            and(
              eq(buildingAccessCodes.orgId, db.orgId),
              inArray(buildingAccessCodes.id, removedCodes),
            ),
          );

        for (const accessCodeId of removedCodes) {
          events.push({ event: "removed", accessCodeId });
        }
      }

      for (const code of codes) {
        if (code.id === null) continue;

        await tx
          .update(buildingAccessCodes)
          .set({
            kind: code.kind,
            label: code.label,
            unitId: code.unitId,
            ...(code.sealed === null
              ? {}
              : {
                  secret: code.sealed.secret,
                  keyVersion: code.sealed.keyVersion,
                  lastRotatedAt: sql`now()`,
                }),
          })
          .where(
            and(
              eq(buildingAccessCodes.orgId, db.orgId),
              eq(buildingAccessCodes.id, code.id),
            ),
          );

        if (code.sealed !== null) {
          events.push({ event: "replaced", accessCodeId: code.id });
        }
      }

      const addedCodes = codes.filter((code) => code.id === null);
      if (addedCodes.length > 0) {
        const added = await tx
          .insert(buildingAccessCodes)
          .values(
            addedCodes.map((code) => ({
              orgId: db.orgId,
              buildingId: building.id,
              kind: code.kind,
              label: code.label,
              unitId: code.unitId,
              secret: code.sealed!.secret,
              keyVersion: code.sealed!.keyVersion,
            })),
          )
          .returning({ id: buildingAccessCodes.id });

        for (const row of added) {
          events.push({ event: "added", accessCodeId: row.id });
        }
      }

      return { ok: true };
    });
  } catch (error) {
    // A unit or contact removed between the check above and the write — the
    // reference refuses it, and the transaction wrote nothing.
    if (sqlState(error) === FOREIGN_KEY_VIOLATION) {
      return refused(UNREADABLE_FORM);
    }

    throw withoutParameters(error, "Saving a building's facts");
  }

  if (result.ok) {
    for (const { event, accessCodeId } of events) {
      recordAccessCodeEvent({
        event,
        orgId: db.orgId,
        userId: user.id,
        accessCodeId,
        buildingId: id.data,
      });
    }
  }

  return result;
}

/**
 * One code, opened — the `Reveal` button's action (`components.md` §9). `ok:
 * false` for a code that is not there, not this org's, or that will not open
 * under this environment's keys: the card says `Couldn't reveal this code`
 * either way, and a caller learns nothing about which ids exist.
 *
 * Every reveal is recorded before the code is returned, and so is one that
 * failed to open — the one to expect is a preview reading production's rows,
 * which ADR-0008 designs to fail.
 */
export async function revealAccessCode(
  accessCodeId: unknown,
): Promise<RevealAccessCodeResult> {
  const { db, user } = await getOrgContext();

  const id = idSchema.safeParse(accessCodeId);
  if (!id.success) return { ok: false };

  const [row] = await db.run((tx) =>
    tx
      .select({
        id: buildingAccessCodes.id,
        buildingId: buildingAccessCodes.buildingId,
        secret: buildingAccessCodes.secret,
        keyVersion: buildingAccessCodes.keyVersion,
      })
      .from(buildingAccessCodes)
      .where(
        and(
          eq(buildingAccessCodes.orgId, db.orgId),
          eq(buildingAccessCodes.id, id.data),
        ),
      ),
  );

  if (!row) return { ok: false };

  const entry = {
    orgId: db.orgId,
    userId: user.id,
    accessCodeId: row.id,
    buildingId: row.buildingId,
  };

  let code: string;

  try {
    code = openAccessCode(keyring(), db.orgId, row);
  } catch (error) {
    if (!(error instanceof AccessCodeCipherError)) throw error;

    recordAccessCodeEvent({ event: "reveal_failed", ...entry });
    return { ok: false };
  }

  recordAccessCodeEvent({ event: "revealed", ...entry });

  return { ok: true, code };
}
