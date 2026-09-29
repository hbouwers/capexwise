/**
 * The expenses' reads (`docs/ui/screens/expenses.md`): the page's period, its
 * spend and the rent beside it, and the one expense the modal opens.
 * Server-only, and each starts from `getOrgContext()`.
 *
 * **Only what the portfolio's figures count**: active buildings, as the
 * dashboard and Maintenance count them. An archived or sold building keeps its
 * expenses — the tax planner reads a sold building's last year — and they are
 * left off this page with the building, as its tasks are left off Maintenance.
 */
import "server-only";

import { and, asc, desc, eq, gte, inArray, lt, min, ne, or } from "drizzle-orm";
import { cache } from "react";
import { z } from "zod";

import {
  buildings,
  capitalItems,
  contacts,
  rentPeriods,
  scheduleECategories,
  tasks,
  transactions,
  units,
} from "@/db/schema";
import { buildingName, compareUnitLabels } from "@/lib/buildings";
import { type CalendarDate, firstOfMonth, todayIn, yearOf } from "@/lib/dates";
import {
  choosePeriod,
  type Classification,
  expenseMonths,
  type ExpensePeriod,
  yearThroughPeriod,
} from "@/lib/expenses";
import { forecastToday } from "@/lib/forecast/params";
import type { Cents } from "@/lib/money";
import type { MonthRange } from "@/lib/rent";
import { getOrgContext, type OrgScopedTx } from "@/server/org-context";
import { listContacts } from "@/server/queries/contacts";
import { ensureRentPeriods } from "@/server/queries/rent-periods";

/** A Schedule E line, as the filter and the modal offer it. */
export type CategoryChoice = { slug: string; label: string; line: number };

/** The categories, in the form's order. Memoised per request. */
export const listScheduleECategories = cache(
  async function listScheduleECategories(): Promise<CategoryChoice[]> {
    const { db } = await getOrgContext();

    return await db.run((tx) =>
      tx
        .select({
          slug: scheduleECategories.slug,
          label: scheduleECategories.label,
          line: scheduleECategories.line,
        })
        .from(scheduleECategories)
        .orderBy(asc(scheduleECategories.line)),
    );
  },
);

/** One expense, as the ledger shows it. */
export type ExpenseRecord = {
  id: string;
  buildingId: string;
  /** Null for the building's own — `Shared`. */
  unitId: string | null;
  unitLabel: string | null;
  occurredOn: CalendarDate;
  /** Signed: negative is money out. */
  amountCents: Cents;
  description: string | null;
  category: string;
  categoryLabel: string;
  classification: Classification | null;
  itemLabel: string | null;
  taskTitle: string | null;
  contactName: string | null;
};

/** A building an expense can be on, and what its rows and the modal need. */
export type ExpenseBuilding = {
  id: string;
  name: string;
  timezone: string;
  /** Not retired, in label order. More than one, and scope is shown. */
  units: { id: string; label: string }[];
};

/** One rent period, for the Rent received tile. */
export type ExpenseRent = {
  buildingId: string;
  periodMonth: CalendarDate;
  amountExpectedCents: Cents;
  amountReceivedCents: Cents | null;
  vacant: boolean;
};

export type ExpensesPage = {
  /** The page's day: the latest of its buildings' (`forecastToday`). */
  today: CalendarDate;
  range: MonthRange;
  period: ExpensePeriod;
  /** Active buildings, by name. */
  buildings: ExpenseBuilding[];
  /**
   * Every expense on them from January of the period's year through the
   * period's end, newest first — the period's own and the year to date that
   * the Cash flow tile needs, in one read. The page partitions.
   */
  expenses: ExpenseRecord[];
  /** Their rent periods over the same months. */
  rent: ExpenseRent[];
  /** Whether anything has ever been recorded on them, in any period. */
  anyRecorded: boolean;
};

/** Active buildings and their units that are not retired, by name. */
async function activeBuildings(
  tx: OrgScopedTx,
  orgId: string,
): Promise<ExpenseBuilding[]> {
  const rows = await tx
    .select({
      id: buildings.id,
      label: buildings.label,
      addressLine1: buildings.addressLine1,
      timezone: buildings.timezone,
    })
    .from(buildings)
    .where(and(eq(buildings.orgId, orgId), eq(buildings.status, "active")));

  const ids = rows.map((row) => row.id);
  const unitRows =
    ids.length === 0
      ? []
      : await tx
          .select({
            id: units.id,
            buildingId: units.buildingId,
            label: units.label,
          })
          .from(units)
          .where(
            and(
              eq(units.orgId, orgId),
              inArray(units.buildingId, ids),
              ne(units.status, "retired"),
            ),
          );

  return rows
    .map((row) => ({
      id: row.id,
      name: buildingName(row),
      timezone: row.timezone,
      units: unitRows
        .filter((unit) => unit.buildingId === row.id)
        .map(({ id, label }) => ({ id, label }))
        .sort((a, b) => compareUnitLabels(a.label, b.label)),
    }))
    .sort((a, b) => compareUnitLabels(a.name, b.name));
}

/**
 * The page for a `?month=` param: its day, the switcher's reach, the period
 * chosen inside it, and the spend and rent the tiles and the ledger are built
 * from.
 *
 * **Viewing the current month opens it**, on every active building in its own
 * zone, through `ensureRentPeriods` — the dashboard's rule and its reason: a
 * building nobody had opened this month would add nothing to the expected
 * half of Rent received, a zero that is really an unopened month. It opens no
 * earlier month. A past month shows what was opened when somebody looked at
 * it, which is what the rent roll shows too.
 */
export async function getExpensesPage(
  requestedMonth: unknown,
  now: Date = new Date(),
): Promise<ExpensesPage> {
  const { db } = await getOrgContext();

  return await db.run(async (tx): Promise<ExpensesPage> => {
    const active = await activeBuildings(tx, db.orgId);
    const ids = active.map((building) => building.id);

    const today = forecastToday(
      active.map((building) => building.timezone),
      now,
    );

    const [earliest] =
      ids.length === 0
        ? []
        : await tx
            .select({ on: min(transactions.occurredOn) })
            .from(transactions)
            .where(
              and(
                eq(transactions.orgId, db.orgId),
                inArray(transactions.buildingId, ids),
              ),
            );

    const range = expenseMonths(today, earliest?.on ?? null);
    const period = choosePeriod(requestedMonth, range);

    if (ids.length === 0) {
      return {
        today,
        range,
        period,
        buildings: [],
        expenses: [],
        rent: [],
        anyRecorded: false,
      };
    }

    const current =
      period.kind === "month"
        ? period.month === range.current
        : period.year === yearOf(range.current);
    if (current) {
      for (const building of active) {
        await ensureRentPeriods(
          tx,
          db.orgId,
          building.id,
          firstOfMonth(todayIn(building.timezone, now)),
        );
      }
    }

    const { from, until } = yearThroughPeriod(period);

    const rows = await tx
      .select({
        id: transactions.id,
        buildingId: transactions.buildingId,
        unitId: transactions.unitId,
        unitLabel: units.label,
        occurredOn: transactions.occurredOn,
        amountCents: transactions.amountCents,
        description: transactions.description,
        category: transactions.scheduleECategory,
        categoryLabel: scheduleECategories.label,
        classification: transactions.classification,
        itemLabel: capitalItems.label,
        taskTitle: tasks.title,
        contactName: contacts.name,
      })
      .from(transactions)
      .innerJoin(
        scheduleECategories,
        eq(scheduleECategories.slug, transactions.scheduleECategory),
      )
      .leftJoin(
        units,
        and(
          eq(units.orgId, transactions.orgId),
          eq(units.id, transactions.unitId),
        ),
      )
      .leftJoin(
        capitalItems,
        and(
          eq(capitalItems.orgId, transactions.orgId),
          eq(capitalItems.id, transactions.capitalItemId),
        ),
      )
      .leftJoin(
        tasks,
        and(
          eq(tasks.orgId, transactions.orgId),
          eq(tasks.id, transactions.taskId),
        ),
      )
      .leftJoin(
        contacts,
        and(
          eq(contacts.orgId, transactions.orgId),
          eq(contacts.id, transactions.contactId),
        ),
      )
      .where(
        and(
          eq(transactions.orgId, db.orgId),
          inArray(transactions.buildingId, ids),
          gte(transactions.occurredOn, from),
          lt(transactions.occurredOn, until),
        ),
      )
      .orderBy(
        desc(transactions.occurredOn),
        desc(transactions.createdAt),
        desc(transactions.id),
      );

    const rent = await tx
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
          gte(rentPeriods.periodMonth, from),
          lt(rentPeriods.periodMonth, until),
        ),
      );

    return {
      today,
      range,
      period,
      buildings: active,
      expenses: rows,
      rent,
      anyRecorded: (earliest?.on ?? null) !== null,
    };
  });
}

/**
 * The portfolio's spend (`docs/ui/screens/portfolio.md`, Cash flow), keyed by
 * building id: every active building's spend in its current month and in its
 * year so far, each judged in its own zone from one instant — the way
 * `getPortfolioRent` reads the rent beside it. Money out is positive here,
 * net of refunds.
 */
export async function getPortfolioSpend(
  now: Date = new Date(),
): Promise<Map<string, { monthCents: Cents; yearCents: Cents }>> {
  const { db } = await getOrgContext();

  return await db.run(async (tx) => {
    const active = await tx
      .select({ id: buildings.id, timezone: buildings.timezone })
      .from(buildings)
      .where(
        and(eq(buildings.orgId, db.orgId), eq(buildings.status, "active")),
      );
    if (active.length === 0) return new Map();

    const months = new Map(
      active.map((building) => [
        building.id,
        firstOfMonth(todayIn(building.timezone, now)),
      ]),
    );

    // The earliest January any of them is in — `getPortfolioRent`'s reason.
    const since = [...months.values()]
      .map((month) => `${yearOf(month)}-01-01`)
      .reduce((earliest, first) => (first < earliest ? first : earliest));

    const rows = await tx
      .select({
        buildingId: transactions.buildingId,
        occurredOn: transactions.occurredOn,
        amountCents: transactions.amountCents,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.orgId, db.orgId),
          inArray(transactions.buildingId, [...months.keys()]),
          gte(transactions.occurredOn, since),
        ),
      );

    const spend = new Map<string, { monthCents: Cents; yearCents: Cents }>();
    for (const [buildingId, month] of months) {
      let monthNet = 0;
      let yearNet = 0;

      for (const row of rows) {
        if (row.buildingId !== buildingId) continue;
        if (yearOf(row.occurredOn) !== yearOf(month)) continue;
        // Nothing is recorded in the future, but a building's zone can be a
        // day behind the one that recorded it.
        if (firstOfMonth(row.occurredOn) > month) continue;

        yearNet += row.amountCents;
        if (firstOfMonth(row.occurredOn) === month) monthNet += row.amountCents;
      }

      spend.set(buildingId, {
        monthCents: monthNet === 0 ? 0 : -monthNet,
        yearCents: yearNet === 0 ? 0 : -yearNet,
      });
    }

    return spend;
  });
}

/** An item the modal can link spend to. */
export type ExpenseItemChoice = {
  id: string;
  label: string;
  unitId: string | null;
  /** False for one replaced or removed, kept because it is already linked. */
  inService: boolean;
};

/** A building in the modal, with its equipment. */
export type ExpenseModalBuilding = ExpenseBuilding & {
  equipment: ExpenseItemChoice[];
};

export type ExpenseContactChoice = {
  id: string;
  name: string;
  company: string | null;
  archived: boolean;
};

/** The whole of one expense, as the modal edits it. */
export type ExpenseDetail = {
  id: string;
  buildingId: string;
  unitId: string | null;
  occurredOn: CalendarDate;
  amountCents: Cents;
  description: string | null;
  scheduleECategory: string;
  classification: Classification | null;
  capitalItemId: string | null;
  contactId: string | null;
  taskId: string | null;
  taskTitle: string | null;
};

/**
 * What `?expense=` opens:
 *
 * - **`new`**: the active buildings an expense can go on — the page's building
 *   chosen when it is one of them. Null, with no active building.
 * - **an id**: the expense and its building, **read-only** when the building
 *   is archived or sold — kept for its history, as every write here refuses
 *   it.
 * - **`not-found`**: an id that is not one, does not exist, or is another
 *   org's, alike — the task modal's rule.
 */
export type ExpenseModal =
  | {
      kind: "new";
      buildings: ExpenseModalBuilding[];
      buildingId: string | null;
      categories: CategoryChoice[];
      contacts: ExpenseContactChoice[];
    }
  | {
      kind: "edit";
      expense: ExpenseDetail;
      building: ExpenseModalBuilding & {
        status: "active" | "archived" | "sold";
      };
      readOnly: boolean;
      categories: CategoryChoice[];
      contacts: ExpenseContactChoice[];
    }
  | { kind: "not-found" };

const expenseIdSchema = z.uuid();

export async function getExpenseModal(
  param: string | null,
  pageBuildingId: string | null,
): Promise<ExpenseModal | null> {
  if (param === null) return null;
  if (param !== "new" && !expenseIdSchema.safeParse(param).success) {
    return { kind: "not-found" };
  }

  const { db } = await getOrgContext();
  const [categories, contactRecords] = await Promise.all([
    listScheduleECategories(),
    listContacts(),
  ]);

  return await db.run(async (tx): Promise<ExpenseModal | null> => {
    const expense =
      param === "new"
        ? null
        : ((
            await tx
              .select({
                id: transactions.id,
                buildingId: transactions.buildingId,
                unitId: transactions.unitId,
                occurredOn: transactions.occurredOn,
                amountCents: transactions.amountCents,
                description: transactions.description,
                scheduleECategory: transactions.scheduleECategory,
                classification: transactions.classification,
                capitalItemId: transactions.capitalItemId,
                contactId: transactions.contactId,
                taskId: transactions.taskId,
                taskTitle: tasks.title,
              })
              .from(transactions)
              .leftJoin(
                tasks,
                and(
                  eq(tasks.orgId, transactions.orgId),
                  eq(tasks.id, transactions.taskId),
                ),
              )
              .where(
                and(
                  eq(transactions.orgId, db.orgId),
                  eq(transactions.id, param),
                ),
              )
          )[0] ?? null);

    if (param !== "new" && expense === null) return { kind: "not-found" };

    // Active contacts, and the one already linked, archived or not — an
    // expense keeps who was paid when they leave the book.
    const contacts = contactRecords
      .filter(
        (contact) =>
          contact.archivedAt === null || contact.id === expense?.contactId,
      )
      .map((contact) => ({
        id: contact.id,
        name: contact.name,
        company: contact.company,
        archived: contact.archivedAt !== null,
      }));

    const buildingRows = await tx
      .select({
        id: buildings.id,
        label: buildings.label,
        addressLine1: buildings.addressLine1,
        timezone: buildings.timezone,
        status: buildings.status,
      })
      .from(buildings)
      .where(
        and(
          eq(buildings.orgId, db.orgId),
          expense === null
            ? eq(buildings.status, "active")
            : eq(buildings.id, expense.buildingId),
        ),
      );

    if (buildingRows.length === 0) return null;

    const ids = buildingRows.map((row) => row.id);
    // Units that are not retired, and the one already linked if it is.
    const unitRows = await tx
      .select({
        id: units.id,
        buildingId: units.buildingId,
        label: units.label,
      })
      .from(units)
      .where(
        and(
          eq(units.orgId, db.orgId),
          inArray(units.buildingId, ids),
          expense?.unitId
            ? or(ne(units.status, "retired"), eq(units.id, expense.unitId))
            : ne(units.status, "retired"),
        ),
      );
    // Equipment in service, and the item already linked if it is not.
    const itemRows = await tx
      .select({
        id: capitalItems.id,
        buildingId: capitalItems.buildingId,
        unitId: capitalItems.unitId,
        label: capitalItems.label,
        status: capitalItems.status,
      })
      .from(capitalItems)
      .where(
        and(
          eq(capitalItems.orgId, db.orgId),
          inArray(capitalItems.buildingId, ids),
          expense?.capitalItemId
            ? or(
                eq(capitalItems.status, "active"),
                eq(capitalItems.id, expense.capitalItemId),
              )
            : eq(capitalItems.status, "active"),
        ),
      );

    const modalBuildings = buildingRows
      .map((row) => ({
        id: row.id,
        name: buildingName(row),
        timezone: row.timezone,
        status: row.status,
        units: unitRows
          .filter((unit) => unit.buildingId === row.id)
          .map(({ id, label }) => ({ id, label }))
          .sort((a, b) => compareUnitLabels(a.label, b.label)),
        equipment: itemRows
          .filter((item) => item.buildingId === row.id)
          .map((item) => ({
            id: item.id,
            label: item.label,
            unitId: item.unitId,
            inService: item.status === "active",
          }))
          .sort((a, b) => compareUnitLabels(a.label, b.label)),
      }))
      .sort((a, b) => compareUnitLabels(a.name, b.name));

    if (expense === null) {
      return {
        kind: "new",
        buildings: modalBuildings,
        buildingId: ids.includes(pageBuildingId ?? "") ? pageBuildingId : null,
        categories,
        contacts,
      };
    }

    const building = modalBuildings[0]!;

    return {
      kind: "edit",
      expense,
      building,
      readOnly: building.status !== "active",
      categories,
      contacts,
    };
  });
}
