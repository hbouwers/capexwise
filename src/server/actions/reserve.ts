"use server";

/**
 * `Update reserve` (`docs/ui/screens/capex-forecast.md`, Reserve projection):
 * the org's balance, the day it was read, and what is added each month,
 * written together — the schema holds a reserve whole or not at all (#92).
 * Starts with `getOrgContext()`, so the org written is the session's; the form
 * names no org and could not choose one.
 */

import { and, eq } from "drizzle-orm";

import { buildings, organizations } from "@/db/schema";
import { forecastToday } from "@/lib/forecast/params";
import type { FieldErrors } from "@/lib/forms";
import { withoutParameters } from "@/lib/query-errors";
import { validateReserve } from "@/lib/reserve-form";
import { getOrgContext } from "@/server/org-context";

export type UpdateReserveResult =
  { ok: true } | { ok: false; errors: FieldErrors };

/**
 * "Today" is the forecast's — the latest of the portfolio's buildings' todays
 * — so the date the form allowed is the date this allows.
 */
export async function updateReserve(
  input: unknown,
): Promise<UpdateReserveResult> {
  const { db } = await getOrgContext();

  try {
    return await db.run(async (tx): Promise<UpdateReserveResult> => {
      const zones = await tx
        .select({ timezone: buildings.timezone })
        .from(buildings)
        .where(
          and(eq(buildings.orgId, db.orgId), eq(buildings.status, "active")),
        );

      const validated = validateReserve(
        input,
        forecastToday(zones.map((row) => row.timezone)),
      );
      if (!validated.ok) return validated;

      await tx
        .update(organizations)
        .set(validated.values)
        .where(eq(organizations.id, db.orgId));

      return { ok: true };
    });
  } catch (error) {
    throw withoutParameters(error, "Updating the reserve");
  }
}
