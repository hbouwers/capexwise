"use server";

/**
 * The capital items' writes (`docs/data-model.md` §5): adding items from the
 * catalogue and taking the batch back, confirming an estimated item, and — the
 * item editor's — editing one, recording its replacement, and removing it. The
 * add-equipment modal and the equipment table call the first three (#110), and
 * the item editor the rest (#125). Each starts with `getOrgContext()`, so the
 * org is the session's, and every id the browser sends — a building, a unit,
 * an item — is looked up inside that org rather than trusted.
 *
 * **Only an active building's equipment is written to.** An archived or sold
 * building is kept for its history and shown without controls, and these
 * refuse it the same way they refuse one that is not there.
 */

import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import {
  buildings,
  capitalItemAllocations,
  capitalItems,
  capitalItemTypes,
  units,
} from "@/db/schema";
import {
  validateCapitalItem,
  validateConfirmation,
  validateReplacement,
} from "@/lib/capital-item-form";
import { rowsForScope, type ScopeChoice } from "@/lib/capital-items";
import { todayIn, yearOf } from "@/lib/dates";
import { type FieldErrors, UNREADABLE_FORM } from "@/lib/forms";
import { withoutParameters } from "@/lib/query-errors";
import { getOrgContext } from "@/server/org-context";

export type AddCapitalItemsResult =
  { ok: true; itemIds: string[] } | { ok: false; errors: FieldErrors };

export type UndoAddCapitalItemsResult =
  { ok: true; removed: number } | { ok: false };

export type ConfirmCapitalItemResult =
  { ok: true } | { ok: false; errors: FieldErrors };

export type RecordReplacementResult =
  { ok: true; itemId: string } | { ok: false; errors: FieldErrors };

export type UpdateCapitalItemResult =
  { ok: true } | { ok: false; errors: FieldErrors };

export type RemoveCapitalItemResult =
  { ok: true } | { ok: false; errors: FieldErrors };

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

/** An item confirmed, replaced or removed since the table was drawn. */
const CONFIRM_NOT_FOUND =
  "This item could not be confirmed. Reload the page — it may have changed since you opened it.";

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
 * What Undo sends back: the ids `addCapitalItems` answered with. Twenty-seven
 * types ticked on a building of a few units is well under the cap.
 */
const undoShape = z.array(z.uuid()).min(1).max(2000);

/**
 * The add toast's Undo (`modal-add-equipment.md`, footer): **removes exactly
 * the rows that add made**, by the ids it returned — and of those, only the
 * ones still as the checklist left them: estimated, active, and with no actual
 * cost. An item confirmed in the seconds since is a fact somebody read off a
 * label, and stays.
 *
 * The same rule is `capital_items_delete_as_added` in `0021`, a restrictive
 * policy, so a delete that forgot the filter below still could not take an
 * audited item or a replaced one. The filter is written anyway, for the reason
 * `src/server/org-context.ts` gives for the org one.
 *
 * Only on an active building, like every write here. Answers how many went,
 * which is fewer than were added when some were confirmed in between.
 */
export async function undoAddCapitalItems(
  buildingId: unknown,
  itemIds: unknown,
): Promise<UndoAddCapitalItemsResult> {
  const { db } = await getOrgContext();

  const id = idSchema.safeParse(buildingId);
  const ids = undoShape.safeParse(itemIds);
  if (!id.success || !ids.success) return { ok: false };

  try {
    return await db.run(async (tx): Promise<UndoAddCapitalItemsResult> => {
      // `for share`, as the add takes it: the building form waits rather than
      // retiring a unit under a delete in flight.
      const [building] = await tx
        .select({ id: buildings.id })
        .from(buildings)
        .where(
          and(
            eq(buildings.orgId, db.orgId),
            eq(buildings.id, id.data),
            eq(buildings.status, "active"),
          ),
        )
        .for("share");

      if (!building) return { ok: false };

      const removed = await tx
        .delete(capitalItems)
        .where(
          and(
            eq(capitalItems.orgId, db.orgId),
            eq(capitalItems.buildingId, building.id),
            inArray(capitalItems.id, ids.data),
            eq(capitalItems.confidence, "estimated"),
            eq(capitalItems.status, "active"),
            isNull(capitalItems.actualCostCents),
          ),
        )
        .returning({ id: capitalItems.id });

      return { ok: true, removed: removed.length };
    });
  } catch (error) {
    throw withoutParameters(error, "Undoing an add of equipment");
  }
}

/**
 * `Confirm` (`building-detail.md`, Equipment & capital items): the estimated
 * item becomes `audited`, with the day it went in — which sets its install
 * year, since the estimate was a guess at that — and what it cost, when known,
 * as its actual cost. That is the tax basis, not the replacement cost, which
 * stays the forecast's figure and is the item editor's to change (#125).
 *
 * Only an estimated, active item on an active building. An item somebody
 * confirmed a moment earlier is refused rather than overwritten: two people
 * reading two labels may have two dates, and the second should see the first's
 * before replacing it.
 */
export async function confirmCapitalItem(
  itemId: unknown,
  input: unknown,
): Promise<ConfirmCapitalItemResult> {
  const { db } = await getOrgContext();

  const id = idSchema.safeParse(itemId);
  if (!id.success) return refused(CONFIRM_NOT_FOUND);

  try {
    return await db.run(async (tx): Promise<ConfirmCapitalItemResult> => {
      // `for update`, so two confirmations of one item cannot both find it
      // estimated.
      const [item] = await tx
        .select({ id: capitalItems.id, timezone: buildings.timezone })
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
            eq(capitalItems.confidence, "estimated"),
            eq(buildings.status, "active"),
          ),
        )
        .for("update", { of: capitalItems });

      if (!item) return refused(CONFIRM_NOT_FOUND);

      const validated = validateConfirmation(input, todayIn(item.timezone));
      if (!validated.ok) return validated;

      await tx
        .update(capitalItems)
        .set({ ...validated.values, confidence: "audited" })
        .where(
          and(eq(capitalItems.orgId, db.orgId), eq(capitalItems.id, item.id)),
        );

      return { ok: true };
    });
  } catch (error) {
    throw withoutParameters(error, "Confirming an item");
  }
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

/** An item edited or removed since the editor opened — replaced, or gone. */
const EDIT_NOT_FOUND =
  "This item could not be saved. Reload the page — it may have changed since you opened it.";

const REMOVE_NOT_FOUND =
  "This item could not be removed. Reload the page — it may have changed since you opened it.";

/** The editor's scope names a unit retired or removed since the page was drawn. */
const SCOPE_GONE =
  "That unit is no longer part of this building. Choose another, or Shared.";

/** A shared item whose cost is split by hand, asked to become one unit's. */
const SPLIT_STAYS_SHARED =
  "This item’s cost is split across units by hand, so it stays shared.";

/**
 * The item editor's `Save`: the item's own fields, under
 * `validateCapitalItem`'s rules. **Only an active item on an active building**
 * — a replaced item has a successor and a removed one is gone, and both are
 * history the editor shows read-only.
 *
 * The scope is resolved against the building's units here, never trusted: a
 * unit must be one of this building's, and not retired unless it is the unit
 * the item is on already — a retired unit keeps what it has, and gets nothing
 * new. The allocation follows the scope (§5): a unit-scoped item is
 * `building_only`, and a shared one keeps its rule, or takes `by_unit_count`
 * when it has just become shared. **An explicit split stays shared**: moving
 * it onto a unit would have to drop its shares, and nothing deletes a share on
 * its own (§7) — the scoped role holds no `delete` on them. Nothing in the
 * product writes a split yet; whatever does will own moving one.
 *
 * An audited item switched to estimated loses its date and keeps its year —
 * the year was the date's, and a guess is what is left of a date somebody no
 * longer stands behind. The basis, `actual_cost_cents`, is whatever the form
 * says in either case.
 */
export async function updateCapitalItem(
  itemId: unknown,
  input: unknown,
): Promise<UpdateCapitalItemResult> {
  const { db } = await getOrgContext();

  const id = idSchema.safeParse(itemId);
  if (!id.success) return refused(EDIT_NOT_FOUND);

  try {
    return await db.run(async (tx): Promise<UpdateCapitalItemResult> => {
      // `for update`, so a replacement and an edit of one item cannot both
      // find it active.
      const [found] = await tx
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

      if (!found) return refused(EDIT_NOT_FOUND);

      const old = found.item;

      const validated = validateCapitalItem(input, todayIn(found.timezone));
      if (!validated.ok) return validated;

      const { unitId, ...values } = validated.values;

      if (unitId !== null && unitId !== old.unitId) {
        const [unit] = await tx
          .select({ id: units.id })
          .from(units)
          .where(
            and(
              eq(units.orgId, db.orgId),
              eq(units.buildingId, old.buildingId),
              eq(units.id, unitId),
              ne(units.status, "retired"),
            ),
          );

        if (!unit) return { ok: false, errors: { scope: SCOPE_GONE } };
      }

      if (unitId !== null && old.allocation === "explicit") {
        return { ok: false, errors: { scope: SPLIT_STAYS_SHARED } };
      }

      const allocation =
        unitId !== null
          ? "building_only"
          : old.unitId !== null
            ? "by_unit_count"
            : old.allocation;

      await tx
        .update(capitalItems)
        .set({ ...values, unitId, allocation })
        .where(
          and(eq(capitalItems.orgId, db.orgId), eq(capitalItems.id, old.id)),
        );

      return { ok: true };
    });
  } catch (error) {
    throw withoutParameters(error, "Saving an item");
  }
}

/**
 * The item editor's `Remove`: the item is gone and nothing took its place, so
 * it is marked `removed` and leaves the table and the forecast (§5). Not a
 * delete — its year and its cost are still the depreciation schedule's (#44),
 * and `Show replaced and removed` brings it back to read.
 *
 * Only an active item on an active building, as every write here: an item
 * already replaced has a successor that says what happened to it.
 */
export async function removeCapitalItem(
  itemId: unknown,
): Promise<RemoveCapitalItemResult> {
  const { db } = await getOrgContext();

  const id = idSchema.safeParse(itemId);
  if (!id.success) return refused(REMOVE_NOT_FOUND);

  try {
    return await db.run(async (tx): Promise<RemoveCapitalItemResult> => {
      const [item] = await tx
        .select({ id: capitalItems.id })
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

      if (!item) return refused(REMOVE_NOT_FOUND);

      await tx
        .update(capitalItems)
        .set({ status: "removed" })
        .where(
          and(eq(capitalItems.orgId, db.orgId), eq(capitalItems.id, item.id)),
        );

      return { ok: true };
    });
  } catch (error) {
    throw withoutParameters(error, "Removing an item");
  }
}
