/**
 * The tax planner's read (`docs/ui/screens/tax-planner.md`): everything
 * `estimate()` in `src/lib/tax/` is given, for the whole portfolio. The page
 * narrows it to one building and calls the module once. Server-only, and it
 * starts from `getOrgContext()`.
 *
 * **Only what the portfolio's figures count**: active buildings, as every
 * other figure counts them. A sold building's last year is #43's.
 *
 * **Every year's ledger and every item, whatever its status**, up to the end
 * of this one. An improvement made in 2019 still recovers in 2026, and an item
 * replaced since was still installed, so the statement needs them to decide
 * what was capitalized and what is part of a building's basis.
 */
import "server-only";

import { and, asc, eq, gte, inArray, lt, ne } from "drizzle-orm";

import {
  buildings,
  capitalItems,
  capitalItemTypes,
  plannedWork,
  rentPeriods,
  scheduleECategories,
  taxYears,
  transactions,
  units,
} from "@/db/schema";
import { buildingName, compareUnitLabels } from "@/lib/buildings";
import { type CalendarDate, firstOfMonth, todayIn, yearOf } from "@/lib/dates";
import { forecastToday } from "@/lib/forecast/params";
import type { Cents } from "@/lib/money";
import type { RecoveryClass } from "@/lib/tax/depreciation";
import { yearRent } from "@/lib/tax/rent";
import type {
  TaxBuilding,
  TaxExpense,
  TaxItem,
  TaxPlan,
} from "@/lib/tax/statement";
import { getOrgContext } from "@/server/org-context";
import { ensureRentPeriods } from "@/server/queries/rent-periods";

/** A building the statement covers, and what the page says about it. */
export type TaxPageBuilding = TaxBuilding & {
  name: string;
  /** Units that are not retired. More than one, and scope is shown. */
  unitCount: number;
  /** Earlier months this year that were opened and never marked. */
  unmarkedRentPeriods: number;
};

/** A plan, and the scope its row shows. */
export type TaxPagePlan = TaxPlan & {
  /** Null for a discretionary project. */
  capitalItemId: string | null;
  /** A unit's label, or null for the building's own: `Shared`. */
  unitLabel: string | null;
};

export type TaxInputs = {
  /** The page's day: the latest of its buildings' (`forecastToday`). */
  today: CalendarDate;
  year: number;
  /** Active buildings, by name. */
  buildings: TaxPageBuilding[];
  expenses: TaxExpense[];
  items: TaxItem[];
  /** Live plans for this year and next: next year's are the levers'. */
  plans: TaxPagePlan[];
  /** A Schedule E category's label, by slug. */
  categoryLabels: Map<string, string>;
  /** Null until somebody enters one: there is no default (#144). */
  rateBps: number | null;
  /** Every year with a row, as the statement takes it. */
  deMinimis: Map<number, Cents | null>;
};

/** An item with no catalogue type recovers as the building does (data-model §5). */
const UNTYPED: RecoveryClass = "residential";

export async function getTaxInputs(now: Date = new Date()): Promise<TaxInputs> {
  const { db } = await getOrgContext();

  return await db.run(async (tx): Promise<TaxInputs> => {
    const buildingRows = await tx
      .select({
        id: buildings.id,
        label: buildings.label,
        addressLine1: buildings.addressLine1,
        timezone: buildings.timezone,
        inServiceOn: buildings.inServiceOn,
        buildingBasisCents: buildings.buildingBasisCents,
      })
      .from(buildings)
      .where(and(eq(buildings.orgId, db.orgId), eq(buildings.status, "active")))
      .orderBy(asc(buildings.id));

    const today = forecastToday(
      buildingRows.map((building) => building.timezone),
      now,
    );
    const year = yearOf(today);
    const ids = buildingRows.map((building) => building.id);

    const taxYearRows = await tx
      .select({
        year: taxYears.year,
        blendedRateBps: taxYears.blendedRateBps,
        deMinimisElected: taxYears.deMinimisElected,
        deMinimisThresholdCents: taxYears.deMinimisThresholdCents,
      })
      .from(taxYears)
      .where(eq(taxYears.orgId, db.orgId));

    const categoryRows = await tx
      .select({
        slug: scheduleECategories.slug,
        label: scheduleECategories.label,
      })
      .from(scheduleECategories);

    const deMinimis = new Map(
      taxYearRows.map((row) => [
        row.year,
        row.deMinimisElected ? row.deMinimisThresholdCents : null,
      ]),
    );
    const rateBps =
      taxYearRows.find((row) => row.year === year)?.blendedRateBps ?? null;
    const categoryLabels = new Map(
      categoryRows.map((row) => [row.slug, row.label]),
    );

    if (ids.length === 0) {
      return {
        today,
        year,
        buildings: [],
        expenses: [],
        items: [],
        plans: [],
        categoryLabels,
        rateBps,
        deMinimis,
      };
    }

    // The current month is part of the expected half, so viewing the year
    // opens it, as the dashboard's view does and for its reason: an unopened
    // month would be a zero that is really nobody having looked.
    const months = new Map(
      buildingRows.map((building) => [
        building.id,
        firstOfMonth(todayIn(building.timezone, now)),
      ]),
    );
    for (const [buildingId, month] of months) {
      await ensureRentPeriods(tx, db.orgId, buildingId, month);
    }

    const periods = await tx
      .select({
        buildingId: rentPeriods.buildingId,
        periodMonth: rentPeriods.periodMonth,
        amountExpectedCents: rentPeriods.amountExpectedCents,
        amountReceivedCents: rentPeriods.amountReceivedCents,
        vacant: rentPeriods.vacant,
      })
      .from(rentPeriods)
      .where(
        and(
          eq(rentPeriods.orgId, db.orgId),
          inArray(rentPeriods.buildingId, ids),
          gte(rentPeriods.periodMonth, `${year}-01-01`),
          lt(rentPeriods.periodMonth, `${year + 1}-01-01`),
        ),
      );

    const unitRows = await tx
      .select({
        id: units.id,
        buildingId: units.buildingId,
        label: units.label,
        status: units.status,
        rentCents: units.rentCents,
      })
      .from(units)
      .where(
        and(
          eq(units.orgId, db.orgId),
          inArray(units.buildingId, ids),
          ne(units.status, "retired"),
        ),
      );

    const named: TaxPageBuilding[] = buildingRows
      .map((building) => {
        const own = unitRows.filter((unit) => unit.buildingId === building.id);
        const rent = yearRent({
          year,
          currentMonth: months.get(building.id)!,
          periods: periods.filter(
            (period) => period.buildingId === building.id,
          ),
          occupiedRentCents: own
            .filter((unit) => unit.status === "occupied")
            .flatMap((unit) =>
              unit.rentCents === null ? [] : [unit.rentCents],
            ),
        });
        const name = buildingName(building);

        return {
          id: building.id,
          label: name,
          name,
          inServiceOn: building.inServiceOn,
          buildingBasisCents: building.buildingBasisCents,
          rent: {
            receivedCents: rent.receivedCents,
            expectedCents: rent.expectedCents,
          },
          unitCount: own.length,
          unmarkedRentPeriods: rent.unmarkedPeriods,
        };
      })
      .sort((a, b) => compareUnitLabels(a.name, b.name));

    const itemRows = await tx
      .select({
        id: capitalItems.id,
        buildingId: capitalItems.buildingId,
        unitLabel: units.label,
        label: capitalItems.label,
        installYear: capitalItems.installYear,
        installDate: capitalItems.installDate,
        actualCostCents: capitalItems.actualCostCents,
        replacementCostCents: capitalItems.replacementCostCents,
        replacedById: capitalItems.replacedById,
        recovery: capitalItemTypes.recoveryClass,
      })
      .from(capitalItems)
      .leftJoin(
        capitalItemTypes,
        eq(capitalItemTypes.slug, capitalItems.typeSlug),
      )
      .leftJoin(
        units,
        and(
          eq(units.orgId, capitalItems.orgId),
          eq(units.id, capitalItems.unitId),
        ),
      )
      .where(
        and(
          eq(capitalItems.orgId, db.orgId),
          inArray(capitalItems.buildingId, ids),
        ),
      );

    const itemsById = new Map(itemRows.map((item) => [item.id, item]));
    // `replaced_by_id` points forward; the statement wants it backward.
    const replaces = new Map(
      itemRows.flatMap((item) =>
        item.replacedById === null ? [] : [[item.replacedById, item.id]],
      ),
    );

    const items: TaxItem[] = itemRows.map((item) => ({
      id: item.id,
      buildingId: item.buildingId,
      label: item.label,
      installYear: item.installYear,
      installDate: item.installDate,
      actualCostCents: item.actualCostCents,
      replacesId: replaces.get(item.id) ?? null,
      recovery: item.recovery ?? UNTYPED,
    }));

    const expenseRows = await tx
      .select({
        id: transactions.id,
        buildingId: transactions.buildingId,
        capitalItemId: transactions.capitalItemId,
        description: transactions.description,
        occurredOn: transactions.occurredOn,
        amountCents: transactions.amountCents,
        category: transactions.scheduleECategory,
        classification: transactions.classification,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.orgId, db.orgId),
          inArray(transactions.buildingId, ids),
          lt(transactions.occurredOn, `${year + 1}-01-01`),
        ),
      );

    const expenses: TaxExpense[] = expenseRows.map((expense) => {
      const item =
        expense.capitalItemId === null
          ? undefined
          : itemsById.get(expense.capitalItemId);

      return {
        id: expense.id,
        buildingId: expense.buildingId,
        capitalItemId: expense.capitalItemId,
        label:
          expense.description ??
          item?.label ??
          categoryLabels.get(expense.category) ??
          expense.category,
        occurredOn: expense.occurredOn,
        amountCents: expense.amountCents,
        category: expense.category,
        classification: expense.classification,
        recovery: item?.recovery ?? UNTYPED,
      };
    });

    const planRows = await tx
      .select({
        id: plannedWork.id,
        buildingId: plannedWork.buildingId,
        capitalItemId: plannedWork.capitalItemId,
        unitId: plannedWork.unitId,
        title: plannedWork.title,
        estCostCents: plannedWork.estCostCents,
        plannedYear: plannedWork.plannedYear,
        plannedMonth: plannedWork.plannedMonth,
        classification: plannedWork.classification,
      })
      .from(plannedWork)
      .where(
        and(
          eq(plannedWork.orgId, db.orgId),
          inArray(plannedWork.buildingId, ids),
          eq(plannedWork.status, "planned"),
          inArray(plannedWork.plannedYear, [year, year + 1]),
        ),
      );

    const unitLabels = new Map(unitRows.map((unit) => [unit.id, unit.label]));
    const plans = planRows.flatMap((plan): TaxPagePlan[] => {
      if (plan.capitalItemId === null) {
        // The check constraint gives a project both; the guard is for types.
        if (plan.title === null || plan.estCostCents === null) return [];

        return [
          {
            id: plan.id,
            buildingId: plan.buildingId,
            capitalItemId: null,
            unitLabel:
              plan.unitId === null
                ? null
                : (unitLabels.get(plan.unitId) ?? null),
            label: plan.title,
            costCents: plan.estCostCents,
            plannedYear: plan.plannedYear,
            plannedMonth: plan.plannedMonth,
            classification: plan.classification,
            recovery: UNTYPED,
          },
        ];
      }

      const item = itemsById.get(plan.capitalItemId);
      if (!item) return [];

      return [
        {
          id: plan.id,
          buildingId: plan.buildingId,
          capitalItemId: item.id,
          unitLabel: item.unitLabel,
          label: item.label,
          costCents: item.replacementCostCents,
          plannedYear: plan.plannedYear,
          plannedMonth: plan.plannedMonth,
          classification: plan.classification,
          recovery: item.recovery ?? UNTYPED,
        },
      ];
    });

    return {
      today,
      year,
      buildings: named,
      expenses,
      items,
      plans,
      categoryLabels,
      rateBps,
      deMinimis,
    };
  });
}
