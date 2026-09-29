/**
 * The forecast page's read (`docs/ui/screens/capex-forecast.md`): the org's
 * reserve, the buildings in the portfolio, and every item in service on them.
 * Server-only, and it starts from `getOrgContext()`.
 */
import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import {
  buildings,
  capitalItems,
  organizations,
  plannedWork,
  units,
} from "@/db/schema";
import { buildingName } from "@/lib/buildings";
import type { CalendarDate } from "@/lib/dates";
import type { ForecastItem } from "@/lib/forecast/outflow";
import type { Cents } from "@/lib/money";
import { getOrgContext } from "@/server/org-context";

/** A building the forecast can be filtered to. */
export type ForecastBuilding = {
  id: string;
  name: string;
  timezone: string;
  /** Units that are not retired — more than one, and scope is shown. */
  unitCount: number;
};

/** An item, and where it is. */
export type ForecastRow = ForecastItem & {
  buildingId: string;
  /** Null for the building's own — `Shared`. */
  unitLabel: string | null;
};

/** The three columns on `organizations`, entered whole (#92). */
export type StoredReserve = {
  balanceCents: Cents;
  asOf: CalendarDate;
  monthlyContributionCents: Cents;
};

export type ForecastInputs = {
  /** Null until one is entered. */
  reserve: StoredReserve | null;
  /** Active buildings, by name. */
  buildings: ForecastBuilding[];
  /** Active items on those buildings, in no order — the forecast sorts. */
  items: ForecastRow[];
};

/** An item's live plan, as a join condition. */
export const livePlanOf = and(
  eq(plannedWork.orgId, capitalItems.orgId),
  eq(plannedWork.capitalItemId, capitalItems.id),
  eq(plannedWork.status, "planned"),
);

/**
 * **Only what the portfolio's figures count**: active buildings, and the
 * active items on them. An archived or sold building is kept for its history
 * and left out of every figure, and a replaced or removed item has a successor
 * or nothing to forecast.
 */
export async function getForecastInputs(): Promise<ForecastInputs> {
  const { db } = await getOrgContext();

  return await db.run(async (tx) => {
    const [org] = await tx
      .select({
        balanceCents: organizations.reserveBalanceCents,
        asOf: organizations.reserveAsOf,
        monthlyContributionCents: organizations.reserveMonthlyContributionCents,
      })
      .from(organizations)
      .where(eq(organizations.id, db.orgId));

    const buildingRows = await tx
      .select({
        id: buildings.id,
        label: buildings.label,
        addressLine1: buildings.addressLine1,
        timezone: buildings.timezone,
        unitCount:
          sql<number>`count(${units.id}) filter (where ${units.status} <> 'retired')`.mapWith(
            Number,
          ),
      })
      .from(buildings)
      .leftJoin(
        units,
        and(
          eq(units.orgId, buildings.orgId),
          eq(units.buildingId, buildings.id),
        ),
      )
      .where(and(eq(buildings.orgId, db.orgId), eq(buildings.status, "active")))
      .groupBy(buildings.id)
      .orderBy(asc(buildings.id));

    const items = await tx
      .select({
        id: capitalItems.id,
        buildingId: capitalItems.buildingId,
        unitLabel: units.label,
        label: capitalItems.label,
        installYear: capitalItems.installYear,
        expectedLifeYears: capitalItems.expectedLifeYears,
        replacementCostCents: capitalItems.replacementCostCents,
        confidence: capitalItems.confidence,
        status: capitalItems.status,
        plannedYear: plannedWork.plannedYear,
      })
      .from(capitalItems)
      .innerJoin(
        buildings,
        and(
          eq(buildings.orgId, capitalItems.orgId),
          eq(buildings.id, capitalItems.buildingId),
        ),
      )
      .leftJoin(
        units,
        and(
          eq(units.orgId, capitalItems.orgId),
          eq(units.id, capitalItems.unitId),
        ),
      )
      // Its live plan (#96). `planned_work_one_live_plan` makes this one row
      // at most, so the join never counts an item twice.
      .leftJoin(plannedWork, livePlanOf)
      .where(
        and(
          eq(capitalItems.orgId, db.orgId),
          eq(capitalItems.status, "active"),
          eq(buildings.status, "active"),
        ),
      );

    const named = buildingRows
      .map((row) => ({
        id: row.id,
        name: buildingName(row),
        timezone: row.timezone,
        unitCount: row.unitCount,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "en-US"));

    // The check constraint holds the three together, so one null is all null.
    const reserve =
      org &&
      org.balanceCents !== null &&
      org.asOf !== null &&
      org.monthlyContributionCents !== null
        ? {
            balanceCents: org.balanceCents,
            asOf: org.asOf,
            monthlyContributionCents: org.monthlyContributionCents,
          }
        : null;

    return { reserve, buildings: named, items };
  });
}
