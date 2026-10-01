"use server";

/**
 * The tax planner's writes (`docs/ui/screens/tax-planner.md`): a plan's
 * repair-or-improvement call, and the year's blended rate. Each starts with
 * `getOrgContext()`, so the org written is the session's, and the plan the
 * browser names is looked up inside it rather than trusted.
 *
 * **Neither computes anything.** The page re-renders from the server after
 * each, so every figure on screen is one `src/lib/tax/` produced from what was
 * saved, never one the browser worked out.
 */

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { buildings, plannedWork, taxYears } from "@/db/schema";
import { yearOf } from "@/lib/dates";
import { forecastToday } from "@/lib/forecast/params";
import type { FieldErrors } from "@/lib/forms";
import { withoutParameters } from "@/lib/query-errors";
import { validateRate } from "@/lib/tax/rate-form";
import { getOrgContext } from "@/server/org-context";

export type ClassifyResult = { ok: true } | { ok: false };

const idSchema = z.uuid();
const classificationSchema = z.enum(["repair", "improvement", "unclassified"]);

/**
 * Sets a live plan's call. `unclassified` is a call too — taking one back —
 * and the statement then names the plan rather than counting it.
 *
 * Refused for a plan that is not live on an active building in this org: one
 * carried out, dropped or archived since the page was drawn, and another
 * org's, alike. Reloading is the fix for all of them.
 */
export async function classifyPlan(
  planId: unknown,
  classification: unknown,
): Promise<ClassifyResult> {
  const { db } = await getOrgContext();

  const id = idSchema.safeParse(planId);
  const call = classificationSchema.safeParse(classification);
  if (!id.success || !call.success) return { ok: false };

  try {
    return await db.run(async (tx): Promise<ClassifyResult> => {
      const [plan] = await tx
        .select({ id: plannedWork.id })
        .from(plannedWork)
        .innerJoin(
          buildings,
          and(
            eq(buildings.orgId, plannedWork.orgId),
            eq(buildings.id, plannedWork.buildingId),
          ),
        )
        .where(
          and(
            eq(plannedWork.orgId, db.orgId),
            eq(plannedWork.id, id.data),
            eq(plannedWork.status, "planned"),
            eq(buildings.status, "active"),
          ),
        )
        .for("update", { of: plannedWork });
      if (!plan) return { ok: false };

      await tx
        .update(plannedWork)
        .set({ classification: call.data })
        .where(
          and(eq(plannedWork.orgId, db.orgId), eq(plannedWork.id, plan.id)),
        );

      return { ok: true };
    });
  } catch (error) {
    throw withoutParameters(error, "Classifying a plan");
  }
}

export type SetTaxRateResult =
  { ok: true } | { ok: false; errors: FieldErrors };

/**
 * The blended rate for the page's year, which is this year: the year list is
 * this one alone until #44 freezes filed years. "This year" is the page's —
 * the latest of the portfolio's buildings' todays — so the year the card
 * showed is the year written.
 *
 * A year with no row is a year with the defaults, so the first rate makes the
 * row, and the de minimis columns take theirs.
 */
export async function setTaxRate(input: unknown): Promise<SetTaxRateResult> {
  const { db } = await getOrgContext();

  const validated = validateRate(input);
  if (!validated.ok) return validated;

  try {
    return await db.run(async (tx): Promise<SetTaxRateResult> => {
      const zones = await tx
        .select({ timezone: buildings.timezone })
        .from(buildings)
        .where(
          and(eq(buildings.orgId, db.orgId), eq(buildings.status, "active")),
        );
      const year = yearOf(forecastToday(zones.map((row) => row.timezone)));

      await tx
        .insert(taxYears)
        .values({ orgId: db.orgId, year, blendedRateBps: validated.rateBps })
        .onConflictDoUpdate({
          target: [taxYears.orgId, taxYears.year],
          set: { blendedRateBps: validated.rateBps },
        });

      return { ok: true };
    });
  } catch (error) {
    throw withoutParameters(error, "Setting the tax rate");
  }
}
