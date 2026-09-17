/**
 * The rent roll's read (`docs/ui/screens/building-detail.md`, Units & rent),
 * and the one write a read makes: opening the month being viewed.
 *
 * **Periods open lazily, on first view, through `ensureRentPeriods`**
 * (`docs/data-model.md` §4). The rent roll rendering September materialises
 * September for every occupied unit, snapshotting each unit's rent as it is
 * at that moment. A unit nobody looks at accrues no rows, which is correct:
 * an un-opened period is not an unpaid one.
 */
import "server-only";

import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  not,
  sql,
} from "drizzle-orm";

import { buildings, rentPeriods, units } from "@/db/schema";
import { type CalendarDate, firstOfMonth, todayIn, yearOf } from "@/lib/dates";
import type { Cents } from "@/lib/money";
import {
  chooseMonth,
  type MonthRange,
  rentRollMonths,
  rentTotals,
} from "@/lib/rent";
import { getOrgContext, type OrgScopedTx } from "@/server/org-context";
import { getBuilding, type UnitRecord } from "@/server/queries/buildings";

/**
 * Opens `month` for every occupied unit of the building that has a rent, and
 * does nothing for a unit whose month is already open — so it is safe to call
 * on every render, and safe when two renders race: the second insert meets
 * `rent_periods_org_unit_month` and does nothing (§4).
 *
 * **The expected amount is the unit's rent at this moment**, copied into the
 * row and never read from the unit again. A rent change after the period
 * opens does not move it; that is the rule §4 calls the most important in the
 * table, and `rent-periods.integration.test.ts` holds it.
 *
 * A unit with no rent is skipped rather than opened at zero, which would be a
 * month expecting nothing that is not marked vacant. The rent roll offers it
 * `Record rent` instead.
 *
 * Takes the transaction it runs in, and the org from the handle that opened
 * it: the caller is `getRentRoll`, which starts from `getOrgContext()`.
 */
export async function ensureRentPeriods(
  tx: OrgScopedTx,
  orgId: string,
  buildingId: string,
  month: CalendarDate,
): Promise<void> {
  // SQL rather than Drizzle's `insert … select`, which wants every column
  // of the table from the select. This is §4's statement as §4 writes it.
  await tx.execute(sql`
    insert into rent_periods
      (org_id, building_id, unit_id, period_month, amount_expected_cents)
    select ${units.orgId}, ${units.buildingId}, ${units.id}, ${month}::date,
           ${units.rentCents}
    from ${units}
    where ${units.orgId} = ${orgId}
      and ${units.buildingId} = ${buildingId}
      and ${units.status} = 'occupied'
      and ${units.rentCents} is not null
    on conflict (org_id, unit_id, period_month) do nothing
  `);
}

export type RentPeriodRecord = Pick<
  typeof rentPeriods.$inferSelect,
  | "id"
  | "periodMonth"
  | "amountExpectedCents"
  | "amountReceivedCents"
  | "receivedOn"
  | "note"
  | "vacant"
>;

/** One row of the rent roll: a unit, and its period for the month if any. */
export type RentRollRow = {
  unit: UnitRecord;
  /**
   * Null for a unit with no period this month: vacant, or occupied with no
   * rent entered — or any unit on a building that is not active, which
   * opens nothing.
   */
  period: RentPeriodRecord | null;
};

export type RentRoll = {
  month: CalendarDate;
  range: MonthRange;
  /** Today where the building is, which every date on the roll is judged by. */
  today: CalendarDate;
  /** Whether the roll can be marked: only an active building's can. */
  editable: boolean;
  rows: RentRollRow[];
  /**
   * Earlier months with a period nobody has marked, newest first — on the
   * current month only, where the spec's `August has 1 unit not marked` goes.
   */
  unmarked: { month: CalendarDate; count: number }[];
};

/**
 * A building's rent roll for the month a `?month=` param asks for, or `null`
 * for a building that is not this org's — `getBuilding`'s 404, which this
 * reads through, so the two agree about which buildings exist.
 *
 * Every unit that is not retired has a row, and a retired unit has one in the
 * months it has a period: it stopped being a leasable space, and its history
 * stays where it was recorded. Rows are in the units' label order.
 *
 * An archived or sold building's roll opens nothing. It is a read-only view,
 * and a view that wrote would open months nobody can mark.
 */
export async function getRentRoll(
  buildingId: unknown,
  requestedMonth: unknown,
): Promise<RentRoll | null> {
  const { db } = await getOrgContext();

  const detail = await getBuilding(buildingId);
  if (!detail) return null;

  const { building } = detail;
  const today = todayIn(building.timezone);
  const range = rentRollMonths(today, building.acquiredOn);
  const month = chooseMonth(requestedMonth, range);
  const editable = building.status === "active";

  const { periods, unmarked } = await db.run(async (tx) => {
    if (editable) await ensureRentPeriods(tx, db.orgId, building.id, month);

    const periods = await tx
      .select({
        id: rentPeriods.id,
        unitId: rentPeriods.unitId,
        periodMonth: rentPeriods.periodMonth,
        amountExpectedCents: rentPeriods.amountExpectedCents,
        amountReceivedCents: rentPeriods.amountReceivedCents,
        receivedOn: rentPeriods.receivedOn,
        note: rentPeriods.note,
        vacant: rentPeriods.vacant,
      })
      .from(rentPeriods)
      .where(
        and(
          eq(rentPeriods.orgId, db.orgId),
          eq(rentPeriods.buildingId, building.id),
          eq(rentPeriods.periodMonth, month),
        ),
      );

    const unmarked =
      month === range.current
        ? await tx
            .select({
              month: rentPeriods.periodMonth,
              count: count(),
            })
            .from(rentPeriods)
            .where(
              and(
                eq(rentPeriods.orgId, db.orgId),
                eq(rentPeriods.buildingId, building.id),
                lt(rentPeriods.periodMonth, month),
                // Only months the switcher can reach, so every line is a
                // link that lands on its month. One from before an
                // acquisition date entered later is not this roll's.
                gte(rentPeriods.periodMonth, range.earliest),
                isNull(rentPeriods.amountReceivedCents),
                not(rentPeriods.vacant),
              ),
            )
            .groupBy(rentPeriods.periodMonth)
            .orderBy(desc(rentPeriods.periodMonth))
        : [];

    return { periods, unmarked };
  });

  const byUnit = new Map(
    periods.map(({ unitId, ...period }) => [unitId, period]),
  );

  const rows = detail.units
    .filter((unit) => unit.status !== "retired" || byUnit.has(unit.id))
    .map((unit) => ({ unit, period: byUnit.get(unit.id) ?? null }));

  return { month, range, today, editable, rows, unmarked };
}

/** One building's rent, as the portfolio's tile and its card read it. */
export type BuildingRent = {
  /** The current month where the building is. */
  month: CalendarDate;
  /** The month's totals, by `rentTotals` — a vacant month in neither half. */
  expectedCents: Cents;
  receivedCents: Cents;
  /** Received for this year's months, January through this one. */
  receivedThisYearCents: Cents;
};

/**
 * The portfolio's rent (`docs/ui/screens/portfolio.md`, Rent received and each
 * card's `Rent {Mon}`), keyed by building id: every active building's current
 * month, and what its months this year took in.
 *
 * **Viewing the portfolio views the current month**, so it opens that month
 * for every active building through `ensureRentPeriods`, as the rent roll
 * does (`docs/data-model.md` §4). Without it, a building nobody had opened
 * this month would read `No rent expected` on its card and add nothing to
 * the tile's expected half — a zero that is really an unopened month. It opens
 * nothing else: no earlier month, since a view of the portfolio is not a view
 * of those, and nothing on an archived or sold building, which the figures
 * leave out.
 *
 * Each building's month is its own, in its own zone (ADR-0005), all read from
 * one instant.
 */
export async function getPortfolioRent(
  now: Date = new Date(),
): Promise<Map<string, BuildingRent>> {
  const { db } = await getOrgContext();

  return await db.run(async (tx) => {
    const active = await tx
      .select({ id: buildings.id, timezone: buildings.timezone })
      .from(buildings)
      .where(
        and(eq(buildings.orgId, db.orgId), eq(buildings.status, "active")),
      );

    const months = new Map(
      active.map((building) => [
        building.id,
        firstOfMonth(todayIn(building.timezone, now)),
      ]),
    );
    if (months.size === 0) return new Map();

    for (const [buildingId, month] of months) {
      await ensureRentPeriods(tx, db.orgId, buildingId, month);
    }

    // The earliest January any of them is in, which is every building's on
    // all but the night the year turns in one zone and not another.
    const since = [...months.values()]
      .map((month) => `${yearOf(month)}-01-01`)
      .reduce((earliest, first) => (first < earliest ? first : earliest));

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
          inArray(rentPeriods.buildingId, [...months.keys()]),
          gte(rentPeriods.periodMonth, since),
        ),
      );

    const rent = new Map<string, BuildingRent>();
    for (const [buildingId, month] of months) {
      const own = periods.filter(
        (period) =>
          period.buildingId === buildingId &&
          yearOf(period.periodMonth) === yearOf(month) &&
          period.periodMonth <= month,
      );

      rent.set(buildingId, {
        month,
        ...rentTotals(own.filter((period) => period.periodMonth === month)),
        receivedThisYearCents: rentTotals(own).receivedCents,
      });
    }

    return rent;
  });
}
