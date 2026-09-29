"use server";

/**
 * Planned work's writes (#96, `docs/data-model.md` §5): choosing the year of
 * an item's next replacement, and giving that choice up. The forecast's
 * `What if?` menu calls both (`docs/ui/screens/capex-forecast.md`). Each starts
 * with `getOrgContext()`, and the item the browser names is looked up inside
 * that org rather than trusted.
 *
 * **Only an active item on an active building is planned for.** The same
 * refusal covers an item that is not there, another org's, and one replaced,
 * removed or archived since the page was drawn, and in every case reloading is
 * the fix.
 */

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { buildings, capitalItems, plannedWork } from "@/db/schema";
import { todayIn, yearOf } from "@/lib/dates";
import { withoutParameters } from "@/lib/query-errors";
import { getOrgContext, type OrgScopedTx } from "@/server/org-context";

export type PlanResult = { ok: true } | { ok: false };

const idSchema = z.uuid();

/**
 * The years a plan may name, the schema's own bound at the top. A deferral can
 * put a replacement past the ten years the chart draws, and a plan for it is
 * still a plan.
 */
const yearSchema = z.int().max(2200);

/**
 * Plans an item's next replacement for `year`: the item's live plan moves to
 * it, or one is made. **One live plan per item**, so a second choice replaces
 * the first rather than adding to it, and `planned_work_one_live_plan` holds
 * that in the table as well.
 *
 * The year is this year or later, this year being the building's. A plan for
 * a year already gone would be a plan somebody did not keep, and the forecast
 * would fold it straight back into this year.
 */
export async function planReplacement(
  itemId: unknown,
  year: unknown,
): Promise<PlanResult> {
  const { db } = await getOrgContext();

  const id = idSchema.safeParse(itemId);
  const planned = yearSchema.safeParse(year);
  if (!id.success || !planned.success) return { ok: false };

  try {
    return await db.run(async (tx): Promise<PlanResult> => {
      const item = await lockPlannable(tx, db.orgId, id.data);
      if (!item || planned.data < yearOf(todayIn(item.timezone))) {
        return { ok: false };
      }

      const moved = await tx
        .update(plannedWork)
        .set({ plannedYear: planned.data })
        .where(livePlan(db.orgId, item.id))
        .returning({ id: plannedWork.id });

      if (moved.length === 0) {
        await tx.insert(plannedWork).values({
          orgId: db.orgId,
          buildingId: item.buildingId,
          capitalItemId: item.id,
          plannedYear: planned.data,
        });
      }

      return { ok: true };
    });
  } catch (error) {
    throw withoutParameters(error, "Planning a replacement");
  }
}

/**
 * `Clear plan`: the item's live plan is `dropped`, and the forecast goes back
 * to the projection. Kept rather than deleted, as every plan is. Refused when
 * there is no live plan to drop, which is a menu drawn before somebody else
 * cleared it.
 */
export async function dropPlan(itemId: unknown): Promise<PlanResult> {
  const { db } = await getOrgContext();

  const id = idSchema.safeParse(itemId);
  if (!id.success) return { ok: false };

  try {
    return await db.run(async (tx): Promise<PlanResult> => {
      const item = await lockPlannable(tx, db.orgId, id.data);
      if (!item) return { ok: false };

      const dropped = await tx
        .update(plannedWork)
        .set({ status: "dropped" })
        .where(livePlan(db.orgId, item.id))
        .returning({ id: plannedWork.id });

      return dropped.length === 1 ? { ok: true } : { ok: false };
    });
  } catch (error) {
    throw withoutParameters(error, "Dropping a plan");
  }
}

/**
 * The item, if it is active on an active building in this org — `for update`,
 * so a replacement or a removal in flight waits, and cannot close a plan this
 * is about to make.
 */
async function lockPlannable(tx: OrgScopedTx, orgId: string, itemId: string) {
  const [item] = await tx
    .select({
      id: capitalItems.id,
      buildingId: capitalItems.buildingId,
      timezone: buildings.timezone,
    })
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
        eq(capitalItems.orgId, orgId),
        eq(capitalItems.id, itemId),
        eq(capitalItems.status, "active"),
        eq(buildings.status, "active"),
      ),
    )
    .for("update", { of: capitalItems });

  return item;
}

function livePlan(orgId: string, itemId: string) {
  return and(
    eq(plannedWork.orgId, orgId),
    eq(plannedWork.capitalItemId, itemId),
    eq(plannedWork.status, "planned"),
  );
}
