"use server";

/**
 * The capital items' writes that are rules rather than edits: adding items
 * from the catalogue, and recording a replacement (`docs/data-model.md` §5).
 * The add-equipment modal and the item editor call these (#110). Each starts
 * with `getOrgContext()`, so the org is the session's, and every id the
 * browser sends — a building, a unit, an item — is looked up inside that org
 * rather than trusted.
 *
 * **Only an active building's equipment is written to.** An archived or sold
 * building is kept for its history and shown without controls, and these
 * refuse it the same way they refuse one that is not there.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  buildings,
  capitalItemAllocations,
  capitalItems,
  capitalItemTypes,
  units,
} from "@/db/schema";
import { validateReplacement } from "@/lib/capital-item-form";
import { rowsForScope, type ScopeChoice } from "@/lib/capital-items";
import { todayIn, yearOf } from "@/lib/dates";
import { type FieldErrors, UNREADABLE_FORM } from "@/lib/forms";
import { withoutParameters } from "@/lib/query-errors";
import { getOrgContext } from "@/server/org-context";

export type AddCapitalItemsResult =
  { ok: true; itemIds: string[] } | { ok: false; errors: FieldErrors };

export type RecordReplacementResult =
  { ok: true; itemId: string } | { ok: false; errors: FieldErrors };

/**
 * One message for a building that is not there, one that is another org's,
 * and one archived since the page was drawn — the modal is out of date in
 * every case, and reloading is the fix.
 */
const BUILDING_NOT_FOUND =
  "The equipment could not be added. Reload the page — the building may have changed since you opened it.";

/** A unit retired, or removed, between the modal opening and the save. */
const UNIT_GONE =
  "A unit you chose is no longer part of this building. Reload the page and choose again.";

/** `Each unit` on a building whose every unit has been retired. */
const NO_UNITS =
  "This building has no units left to add equipment to. Choose Shared instead.";

/** The item's counterpart to `BUILDING_NOT_FOUND`, replaced or removed too. */
const ITEM_NOT_FOUND =
  "This item could not be replaced. Reload the page — it may have changed since you opened it.";

const idSchema = z.uuid();

/**
 * What the modal sends: each ticked type, where it goes, and the install year
 * it showed for it. The year is the modal's seed (#110), sent rather than
 * recomputed so the item gets the year the person saw; it is still held to
 * one that has happened.
 */
const additionShape = z.object({
  items: z
    .array(
      z.object({
        type: z.string().max(200),
        scope: z.union([z.literal("each"), z.literal("shared"), z.uuid()]),
        installYear: z.int().min(1600).max(2200),
      }),
    )
    .min(1)
    .max(200),
});

function refused(message: string): { ok: false; errors: FieldErrors } {
  return { ok: false, errors: { form: message } };
}

function scopeChoice(scope: string): ScopeChoice {
  return scope === "each" || scope === "shared" ? scope : { unitId: scope };
}

/**
 * Adds what the checklist ticked, in one transaction — all of it or none of
 * it, so a failed save leaves the modal's ticks meaning what they did
 * (`modal-add-equipment.md`, States).
 *
 * **The catalogue's defaults are copied onto each item here**, read inside
 * the transaction and never taken from the request: the label, the life and
 * the replacement cost become the item's own, so refreshing the catalogue
 * later moves nobody's numbers (§5). Everything added is `estimated`.
 *
 * `Each unit` makes one item per unit that is not retired; a unit named
 * directly must be one of those too. Returns the new ids in the order they
 * were made, which is what the modal's Undo removes.
 */
export async function addCapitalItems(
  buildingId: unknown,
  input: unknown,
): Promise<AddCapitalItemsResult> {
  const { db } = await getOrgContext();

  const id = idSchema.safeParse(buildingId);
  if (!id.success) return refused(BUILDING_NOT_FOUND);

  const parsed = additionShape.safeParse(input);
  if (!parsed.success) return refused(UNREADABLE_FORM);

  const requested = parsed.data.items;

  return await db.run(async (tx): Promise<AddCapitalItemsResult> => {
    // `for share`: the building form's save takes this row `for update`
    // before it retires or removes a unit, so it waits for this add to
    // finish, and this add cannot put equipment on a unit it is retiring.
    const [building] = await tx
      .select({ id: buildings.id, timezone: buildings.timezone })
      .from(buildings)
      .where(
        and(
          eq(buildings.orgId, db.orgId),
          eq(buildings.id, id.data),
          eq(buildings.status, "active"),
        ),
      )
      .for("share");

    if (!building) return refused(BUILDING_NOT_FOUND);

    const thisYear = yearOf(todayIn(building.timezone));
    if (requested.some((item) => item.installYear > thisYear)) {
      return refused(UNREADABLE_FORM);
    }

    const buildingUnits = await tx
      .select({ id: units.id, status: units.status })
      .from(units)
      .where(and(eq(units.orgId, db.orgId), eq(units.buildingId, building.id)))
      .orderBy(asc(units.id));

    const types = await tx
      .select()
      .from(capitalItemTypes)
      .where(
        inArray(
          capitalItemTypes.slug,
          requested.map((item) => item.type),
        ),
      );
    const bySlug = new Map(types.map((type) => [type.slug, type]));

    const rows: (typeof capitalItems.$inferInsert)[] = [];

    for (const item of requested) {
      const type = bySlug.get(item.type);
      if (!type) return refused(UNREADABLE_FORM);

      const scoped = rowsForScope(scopeChoice(item.scope), buildingUnits);
      if (scoped === null) return refused(UNIT_GONE);
      if (scoped.length === 0) return refused(NO_UNITS);

      for (const { unitId, allocation } of scoped) {
        rows.push({
          orgId: db.orgId,
          buildingId: building.id,
          unitId,
          typeSlug: type.slug,
          label: type.label,
          installYear: item.installYear,
          expectedLifeYears: type.defaultLifeYears,
          replacementCostCents: type.defaultCostCents,
          allocation,
        });
      }
    }

    const added = await tx
      .insert(capitalItems)
      .values(rows)
      .returning({ id: capitalItems.id });

    return { ok: true, itemIds: added.map((row) => row.id) };
  });
}

/**
 * `Record replacement`: the item was replaced, so **a new row takes over and
 * the old one is marked `replaced`**, pointing at it (§5). The old row's
 * install year is never edited — #44's depreciation schedule needs the item
 * that was in service, its year and its cost, after it is gone.
 *
 * The new row is the same thing in the same place: the old one's type, label,
 * scope, split and expected life, and its replacement cost, which is the
 * person's figure for the next one. It is `audited`, from the day it went in,
 * with what it cost as its actual cost. The old one's notes stay with it —
 * they describe the machine that was there.
 *
 * Only an active item: one already replaced has a successor, and one removed
 * is gone. A failed write is re-thrown with its SQLSTATE only, as the other
 * forms' are.
 */
export async function recordReplacement(
  itemId: unknown,
  input: unknown,
): Promise<RecordReplacementResult> {
  const { db } = await getOrgContext();

  const id = idSchema.safeParse(itemId);
  if (!id.success) return refused(ITEM_NOT_FOUND);

  try {
    return await db.run(async (tx): Promise<RecordReplacementResult> => {
      // `for update`, so two replacements of one item cannot both find it
      // active and each add a successor.
      const [item] = await tx
        .select({ item: capitalItems, timezone: buildings.timezone })
        .from(capitalItems)
        .innerJoin(
          buildings,
          and(
            eq(buildings.orgId, capitalItems.orgId),
            eq(buildings.id, capitalItems.buildingId),
          ),
        )
        .where(
          and(
            eq(capitalItems.orgId, db.orgId),
            eq(capitalItems.id, id.data),
            eq(capitalItems.status, "active"),
            eq(buildings.status, "active"),
          ),
        )
        .for("update", { of: capitalItems });

      if (!item) return refused(ITEM_NOT_FOUND);

      const old = item.item;

      const validated = validateReplacement(input, todayIn(item.timezone), old);
      if (!validated.ok) return validated;

      const [successor] = await tx
        .insert(capitalItems)
        .values({
          orgId: db.orgId,
          buildingId: old.buildingId,
          unitId: old.unitId,
          typeSlug: old.typeSlug,
          label: old.label,
          ...validated.values,
          confidence: "audited",
          expectedLifeYears: old.expectedLifeYears,
          replacementCostCents: old.replacementCostCents,
          allocation: old.allocation,
        })
        .returning({ id: capitalItems.id });

      if (!successor) throw new Error("Inserting an item returned no row.");

      // An explicit split carries over, share for share — the new furnace
      // heats what the old one did. The deferred sum rule holds it at commit.
      if (old.allocation === "explicit") {
        const shares = await tx
          .select({
            unitId: capitalItemAllocations.unitId,
            shareBps: capitalItemAllocations.shareBps,
          })
          .from(capitalItemAllocations)
          .where(
            and(
              eq(capitalItemAllocations.orgId, db.orgId),
              eq(capitalItemAllocations.capitalItemId, old.id),
            ),
          );

        await tx.insert(capitalItemAllocations).values(
          shares.map((share) => ({
            orgId: db.orgId,
            buildingId: old.buildingId,
            capitalItemId: successor.id,
            ...share,
          })),
        );
      }

      await tx
        .update(capitalItems)
        .set({ status: "replaced", replacedById: successor.id })
        .where(
          and(eq(capitalItems.orgId, db.orgId), eq(capitalItems.id, old.id)),
        );

      return { ok: true, itemId: successor.id };
    });
  } catch (error) {
    throw withoutParameters(error, "Recording a replacement");
  }
}
