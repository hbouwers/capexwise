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

import { buildings, units } from "@/db/schema";
import {
  type FieldErrors,
  UNREADABLE_FORM,
  type UnitValues,
  validateBuilding,
} from "@/lib/building-form";
import { getOrgContext, type OrgScopedDb } from "@/server/org-context";

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
 * Removing a unit is a delete. Nothing references a unit yet, so every unit
 * can be removed; when rent periods arrive (#108) a unit with history gets
 * `Retire` instead, and `units`' `restrict` refuses the delete if anything
 * still asks for one.
 */
export async function updateBuilding(
  buildingId: unknown,
  input: unknown,
): Promise<SaveBuildingResult> {
  const { db } = await getOrgContext();

  const id = buildingIdSchema.safeParse(buildingId);
  if (!id.success) return refused(NOT_FOUND);

  const validated = validateBuilding(input);
  if (!validated.ok) return validated;

  const { units: submitted, ...building } = validated.values;

  return await db.run(async (tx): Promise<SaveBuildingResult> => {
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

    await tx
      .update(buildings)
      .set(building)
      .where(and(eq(buildings.orgId, db.orgId), eq(buildings.id, existing.id)));

    const removed = current.filter((unit) => !keptIds.has(unit.id));
    if (removed.length > 0) {
      await tx.delete(units).where(
        and(
          eq(units.orgId, db.orgId),
          inArray(
            units.id,
            removed.map((unit) => unit.id),
          ),
        ),
      );
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
  });
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
