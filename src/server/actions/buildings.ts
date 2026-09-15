"use server";

/**
 * The building form's writes (`docs/ui/screens/building-form.md`): create,
 * edit, archive and restore. Every one starts with `getOrgContext()`, so the
 * org they write to is the session's and never the request's — nothing a
 * browser sends names an org, and an id it sends for a building or a unit is
 * looked up inside the org rather than trusted.
 *
 * **Every input is `unknown`.** An action's arguments arrive from the browser,
 * and the form that normally calls these is no evidence of what a request
 * carries. `validateBuilding` is the same function the form runs before it
 * sends anything, so a person sees the same messages from either side, and a
 * request the form could not have made gets one message and no write.
 *
 * They return a result rather than redirecting. The form decides where to go
 * and says so in a toast, and a failed save has to leave the form exactly as
 * it was typed (`docs/ui/screens/README.md`, errors).
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
  buildingAccessCodes,
  buildings,
  buildingUtilities,
  capitalItemAllocations,
  capitalItems,
  rentPeriods,
  units,
} from "@/db/schema";
import { type UnitValues, validateBuilding } from "@/lib/building-form";
import { type FieldErrors, UNREADABLE_FORM } from "@/lib/forms";
import { sqlState } from "@/lib/query-errors";
import { recordAccessCodeEvent } from "@/server/access-codes";
import {
  getOrgContext,
  type OrgScopedDb,
  type OrgScopedTx,
} from "@/server/org-context";

export type SaveBuildingResult =
  { ok: true; buildingId: string } | { ok: false; errors: FieldErrors };

/**
 * The same words for a building that does not exist and one that belongs to
 * another org, as the page's 404 is the same — so an action cannot be used to
 * learn which ids exist.
 */
const NOT_FOUND =
  "This building could not be found. It may have been removed, or it may be in another organization.";

const buildingIdSchema = z.uuid();

function refused(message: string): SaveBuildingResult {
  return { ok: false, errors: { form: message } };
}

/** `on delete restrict` refused a delete: something still hangs off the row. */
const RESTRICT_VIOLATION = "23001";

const UNIT_GAINED_RENT =
  "A unit you removed has had rent recorded since you opened this form. Reload the page and retire it instead — its months stay on the rent roll.";

/**
 * A unit the form added. It has no id yet, and it cannot arrive retired —
 * retiring is something that happens to a unit with history, which a new one
 * does not have.
 */
function isNew(unit: UnitValues): boolean {
  return unit.id === null;
}

function unitColumns(unit: UnitValues) {
  return {
    label: unit.label,
    status: unit.status,
    rentCents: unit.rentCents,
    leaseEnd: unit.leaseEnd,
  };
}

/** A new building and its units, in one transaction. */
export async function createBuilding(
  input: unknown,
): Promise<SaveBuildingResult> {
  const { db } = await getOrgContext();

  const validated = validateBuilding(input);
  if (!validated.ok) return validated;

  const { units: submitted, ...building } = validated.values;

  if (
    !submitted.every(isNew) ||
    submitted.some((u) => u.status === "retired")
  ) {
    return refused(UNREADABLE_FORM);
  }

  const buildingId = await db.run(async (tx) => {
    const [row] = await tx
      .insert(buildings)
      .values({ ...building, orgId: db.orgId })
      .returning({ id: buildings.id });

    if (!row) throw new Error("Inserting a building returned no row.");

    await tx.insert(units).values(
      submitted.map((unit) => ({
        orgId: db.orgId,
        buildingId: row.id,
        ...unitColumns(unit),
      })),
    );

    return row.id;
  });

  return { ok: true, buildingId };
}

/**
 * The edit form's save: the building's own fields, and its units reconciled
 * against what was submitted — a row with an id is that unit, edited; a row
 * without one is a new unit; a unit missing from the submission was removed.
 *
 * A submitted unit id is only ever a lookup into this building's own units.
 * One that is not among them — another building's, another org's, invented —
 * refuses the whole save before anything is written, rather than being
 * skipped: a save that quietly dropped a row would look like it worked.
 *
 * Removing a unit is a delete, and only a unit with no rent history can be
 * removed: one with months of rent is retired instead (`docs/data-model.md`
 * §7), which the form offers in its place, and a submission that removes one
 * anyway is refused with the units named. Equipment holds a unit back the
 * same way — its own items, or its share of a shared one split explicitly
 * (§5). Two things on the building's facts hang off a unit as well (§3). A
 * utility account holds the unit back until the account is moved or removed,
 * and the save says which unit. An access code goes with its unit, and is
 * recorded as removed, as a code removed in the facts editor is (ADR-0008).
 */
export async function updateBuilding(
  buildingId: unknown,
  input: unknown,
): Promise<SaveBuildingResult> {
  const { db, user } = await getOrgContext();

  const id = buildingIdSchema.safeParse(buildingId);
  if (!id.success) return refused(NOT_FOUND);

  const validated = validateBuilding(input);
  if (!validated.ok) return validated;

  const { units: submitted, ...building } = validated.values;

  const removedCodes: { id: string; buildingId: string }[] = [];

  const save = async (tx: OrgScopedTx): Promise<SaveBuildingResult> => {
    // `for update`: two saves of one building serialise here, so neither
    // reconciles its units against a list the other has already changed.
    const [existing] = await tx
      .select({ id: buildings.id })
      .from(buildings)
      .where(and(eq(buildings.orgId, db.orgId), eq(buildings.id, id.data)))
      .for("update");

    if (!existing) return refused(NOT_FOUND);

    const current = await tx
      .select({ id: units.id, label: units.label })
      .from(units)
      .where(and(eq(units.orgId, db.orgId), eq(units.buildingId, existing.id)));

    const labels = new Map(current.map((unit) => [unit.id, unit.label]));
    const kept = submitted.filter((unit) => !isNew(unit));
    const keptIds = new Set(kept.map((unit) => unit.id));

    if (
      kept.some((unit) => !labels.has(unit.id!)) ||
      keptIds.size !== kept.length ||
      submitted.some((unit) => isNew(unit) && unit.status === "retired")
    ) {
      return refused(UNREADABLE_FORM);
    }

    const removed = current.filter((unit) => !keptIds.has(unit.id));
    const removedIds = removed.map((unit) => unit.id);

    if (removed.length > 0) {
      // Before the accounts: retiring is the answer for a unit with history,
      // and it needs no account moved first.
      const history = await tx
        .selectDistinct({ unitId: rentPeriods.unitId })
        .from(rentPeriods)
        .where(
          and(
            eq(rentPeriods.orgId, db.orgId),
            inArray(rentPeriods.unitId, removedIds),
          ),
        );

      if (history.length > 0) {
        const held = removed.filter((unit) =>
          history.some((row) => row.unitId === unit.id),
        );

        return {
          ok: false,
          errors: { units: unitsWithRent(held.map((unit) => unit.label)) },
        };
      }

      // Equipment is history too (§7): a unit's own items, and its share of
      // a shared one split explicitly. Retiring keeps both where they are.
      const equipped = [
        ...(await tx
          .selectDistinct({ unitId: capitalItems.unitId })
          .from(capitalItems)
          .where(
            and(
              eq(capitalItems.orgId, db.orgId),
              inArray(capitalItems.unitId, removedIds),
            ),
          )),
        ...(await tx
          .selectDistinct({ unitId: capitalItemAllocations.unitId })
          .from(capitalItemAllocations)
          .where(
            and(
              eq(capitalItemAllocations.orgId, db.orgId),
              inArray(capitalItemAllocations.unitId, removedIds),
            ),
          )),
      ];

      if (equipped.length > 0) {
        const held = removed.filter((unit) =>
          equipped.some((row) => row.unitId === unit.id),
        );

        return {
          ok: false,
          errors: { units: unitsWithEquipment(held.map((unit) => unit.label)) },
        };
      }

      const accounts = await tx
        .select({ unitId: buildingUtilities.unitId })
        .from(buildingUtilities)
        .where(
          and(
            eq(buildingUtilities.orgId, db.orgId),
            inArray(buildingUtilities.unitId, removedIds),
          ),
        );

      if (accounts.length > 0) {
        const held = removed.filter((unit) =>
          accounts.some((account) => account.unitId === unit.id),
        );

        return {
          ok: false,
          errors: { units: unitsWithAccounts(held.map((unit) => unit.label)) },
        };
      }

      removedCodes.push(
        ...(await tx
          .select({
            id: buildingAccessCodes.id,
            buildingId: buildingAccessCodes.buildingId,
          })
          .from(buildingAccessCodes)
          .where(
            and(
              eq(buildingAccessCodes.orgId, db.orgId),
              inArray(buildingAccessCodes.unitId, removedIds),
            ),
          )),
      );
    }

    await tx
      .update(buildings)
      .set(building)
      .where(and(eq(buildings.orgId, db.orgId), eq(buildings.id, existing.id)));

    if (removed.length > 0) {
      await tx
        .delete(units)
        .where(and(eq(units.orgId, db.orgId), inArray(units.id, removedIds)));
    }

    // Two passes over the renamed units, so that swapping two labels — A
    // becomes B and B becomes A — never has both rows holding one label at
    // once, which `units_org_building_label` would refuse mid-save. The first
    // pass parks each on its own id, which no other unit can hold.
    const renamed = kept
      .filter((unit) => labels.get(unit.id!) !== unit.label)
      .map((unit) => unit.id!);
    if (renamed.length > 0) {
      await tx
        .update(units)
        .set({ label: sql`${units.id}::text` })
        .where(and(eq(units.orgId, db.orgId), inArray(units.id, renamed)));
    }

    for (const unit of kept) {
      await tx
        .update(units)
        .set(unitColumns(unit))
        .where(and(eq(units.orgId, db.orgId), eq(units.id, unit.id!)));
    }

    const added = submitted.filter(isNew);
    if (added.length > 0) {
      await tx.insert(units).values(
        added.map((unit) => ({
          orgId: db.orgId,
          buildingId: existing.id,
          ...unitColumns(unit),
        })),
      );
    }

    return { ok: true, buildingId: existing.id };
  };

  // A unit removed here that had a month of rent opened after the check
  // above — a view of the building's page, or `Record rent`, in between. Its
  // `restrict` refuses the delete, the transaction wrote nothing, and the
  // answer is the one the check would have given.
  const result = await db
    .run(save)
    .catch((error: unknown): SaveBuildingResult => {
      if (sqlState(error) !== RESTRICT_VIOLATION) throw error;

      return { ok: false, errors: { units: UNIT_GAINED_RENT } };
    });

  // After the commit, so a save that failed records nothing.
  if (result.ok) {
    for (const code of removedCodes) {
      recordAccessCodeEvent({
        event: "removed",
        orgId: db.orgId,
        userId: user.id,
        accessCodeId: code.id,
        buildingId: code.buildingId,
      });
    }
  }

  return result;
}

/** `“A”`, `“A” and “B”`, `“A”, “B” and “C”`. */
function quotedList(labels: readonly string[]): string {
  const quoted = labels.map((label) => `“${label}”`);

  return quoted.length === 1
    ? quoted[0]!
    : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

/**
 * The units list's message when a unit removed on this form has months of
 * rent recorded — which the form's `Retire` avoids, so this is a form drawn
 * before the unit's first month was opened.
 */
function unitsWithRent(labels: readonly string[]): string {
  const names = quotedList(labels);

  return labels.length === 1
    ? `Unit ${names} has rent recorded, so it can’t be removed. Retire it instead — its months stay on the rent roll.`
    : `Units ${names} have rent recorded, so they can’t be removed. Retire them instead — their months stay on the rent roll.`;
}

/**
 * The units list's message when a unit removed on this form has equipment
 * recorded against it — its own, or a share of a shared item.
 */
function unitsWithEquipment(labels: readonly string[]): string {
  const names = quotedList(labels);

  return labels.length === 1
    ? `Unit ${names} has equipment recorded, so it can’t be removed. Retire it instead — its equipment stays on the building’s page.`
    : `Units ${names} have equipment recorded, so they can’t be removed. Retire them instead — their equipment stays on the building’s page.`;
}

/**
 * The units list's message when a unit removed on this form still has a
 * utility account on the building's facts. It names the units, because the
 * form may have removed more than one, and says where the account is.
 */
function unitsWithAccounts(labels: readonly string[]): string {
  const names = quotedList(labels);

  return labels.length === 1
    ? `Unit ${names} has a utility account in Building facts. Change the account to Shared, or remove it there, before removing the unit.`
    : `Units ${names} have utility accounts in Building facts. Change the accounts to Shared, or remove them there, before removing the units.`;
}

/**
 * Takes a building out of the portfolio's figures and keeps its history
 * (§7). Only an active building: a sold one is #43's, and archiving it would
 * lose which of the two it was.
 *
 * `ok: false` for a building that is not there, not this org's, or not
 * active — the form has nothing different to say about any of them.
 */
export async function archiveBuilding(
  buildingId: unknown,
): Promise<{ ok: boolean }> {
  const { db } = await getOrgContext();

  return await setStatus(db, buildingId, "active", "archived");
}

/** Puts an archived building back into the portfolio. */
export async function restoreBuilding(
  buildingId: unknown,
): Promise<{ ok: boolean }> {
  const { db } = await getOrgContext();

  return await setStatus(db, buildingId, "archived", "active");
}

async function setStatus(
  db: OrgScopedDb,
  buildingId: unknown,
  from: "active" | "archived",
  to: "active" | "archived",
): Promise<{ ok: boolean }> {
  const id = buildingIdSchema.safeParse(buildingId);
  if (!id.success) return { ok: false };

  const rows = await db.run((tx) =>
    tx
      .update(buildings)
      .set({ status: to })
      .where(
        and(
          eq(buildings.orgId, db.orgId),
          eq(buildings.id, id.data),
          eq(buildings.status, from),
        ),
      )
      .returning({ id: buildings.id }),
  );

  return { ok: rows.length === 1 };
}
