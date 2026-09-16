/**
 * The tasks' reads: every open and recent task across the portfolio for
 * Maintenance, and a building's recurring tasks for its page
 * (`docs/ui/screens/maintenance.md`, `building-detail.md`). Server-only, and
 * each starts from `getOrgContext()`.
 */
import "server-only";

import { and, eq, inArray, isNotNull, ne, type SQL, sql } from "drizzle-orm";

import { buildings, contacts, tasks, tradeTags, units } from "@/db/schema";
import { buildingName, compareUnitLabels } from "@/lib/buildings";
import type { CalendarDate } from "@/lib/dates";
import type { Cents } from "@/lib/money";
import type { Priority } from "@/lib/tasks";
import { getOrgContext, type OrgScopedTx } from "@/server/org-context";

/**
 * Who a task is assigned to, as the tables write it: a contact by name, the
 * viewer as `Me`, another member as `A member` until #30 gives the scoped role
 * a way to read their names, or nobody.
 */
export type Assignee =
  | { kind: "contact"; name: string }
  | { kind: "me" }
  | { kind: "member" }
  | null;

/** One task, as Maintenance and the building page show it. */
export type TaskRecord = {
  id: string;
  buildingId: string;
  /** Null for the building's own — `Shared`. */
  unitId: string | null;
  unitLabel: string | null;
  title: string;
  notes: string | null;
  tradeLabel: string | null;
  status: "unscheduled" | "scheduled" | "done";
  priority: Priority;
  dueDate: CalendarDate | null;
  completedOn: CalendarDate | null;
  confirmedOn: CalendarDate | null;
  assignee: Assignee;
  estCostCents: Cents | null;
  actualCostCents: Cents | null;
  recurrenceMonths: number | null;
  /** The day it was added at its building — `added Aug 23`. */
  addedOn: CalendarDate;
};

/** A building a task can be on, and what its rows need of it. */
export type TaskBuilding = {
  id: string;
  name: string;
  timezone: string;
  /** Not retired, in label order. More than one, and scope is shown. */
  units: { id: string; label: string }[];
};

export type MaintenanceInputs = {
  /** Active buildings, by name. */
  buildings: TaskBuilding[];
  /** Their tasks that are not cancelled, in no order — the page sorts. */
  tasks: TaskRecord[];
};

function assigneeOf(
  row: { contactName: string | null; assigneeUserId: string | null },
  viewerId: string,
): Assignee {
  if (row.contactName !== null)
    return { kind: "contact", name: row.contactName };
  if (row.assigneeUserId === null) return null;
  return row.assigneeUserId === viewerId ? { kind: "me" } : { kind: "member" };
}

/**
 * Every task read: the task, its unit's label, its trade's label, and its
 * contact's name, joined on the org as well as the id. `addedOn` is the row's
 * creation moment as a day at its building, in SQL, where the zone is a column.
 */
function selectTasks(tx: OrgScopedTx, where: SQL | undefined) {
  return tx
    .select({
      id: tasks.id,
      buildingId: tasks.buildingId,
      unitId: tasks.unitId,
      unitLabel: units.label,
      title: tasks.title,
      notes: tasks.notes,
      tradeLabel: tradeTags.label,
      status: tasks.status,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      completedOn: tasks.completedOn,
      confirmedOn: tasks.confirmedOn,
      contactName: contacts.name,
      assigneeUserId: tasks.assigneeUserId,
      estCostCents: tasks.estCostCents,
      actualCostCents: tasks.actualCostCents,
      recurrenceMonths: tasks.recurrenceMonths,
      addedOn: sql<CalendarDate>`to_char(${tasks.createdAt} at time zone ${buildings.timezone}, 'YYYY-MM-DD')`,
    })
    .from(tasks)
    .innerJoin(
      buildings,
      and(eq(buildings.orgId, tasks.orgId), eq(buildings.id, tasks.buildingId)),
    )
    .leftJoin(
      units,
      and(eq(units.orgId, tasks.orgId), eq(units.id, tasks.unitId)),
    )
    .leftJoin(tradeTags, eq(tradeTags.slug, tasks.tradeTag))
    .leftJoin(
      contacts,
      and(
        eq(contacts.orgId, tasks.orgId),
        eq(contacts.id, tasks.assigneeContactId),
      ),
    )
    .where(where);
}

type TaskRow = Awaited<ReturnType<typeof selectTasks>>[number];

function toRecord(row: TaskRow, viewerId: string): TaskRecord {
  const { contactName, assigneeUserId, status, ...rest } = row;

  return {
    ...rest,
    // Every read leaves cancelled tasks out.
    status: status as TaskRecord["status"],
    assignee: assigneeOf({ contactName, assigneeUserId }, viewerId),
  };
}

/**
 * **Only what the portfolio's figures count**: active buildings, and their
 * tasks that are not cancelled. An archived or sold building is kept for its
 * history and left out of the portfolio, as the forecast leaves it out.
 */
export async function getMaintenanceInputs(): Promise<MaintenanceInputs> {
  const { db, user } = await getOrgContext();

  return await db.run(async (tx) => {
    const buildingRows = await tx
      .select({
        id: buildings.id,
        label: buildings.label,
        addressLine1: buildings.addressLine1,
        timezone: buildings.timezone,
      })
      .from(buildings)
      .where(
        and(eq(buildings.orgId, db.orgId), eq(buildings.status, "active")),
      );

    const ids = buildingRows.map((row) => row.id);
    if (ids.length === 0) return { buildings: [], tasks: [] };

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
          ne(units.status, "retired"),
        ),
      );

    const rows = await selectTasks(
      tx,
      and(
        eq(tasks.orgId, db.orgId),
        eq(buildings.status, "active"),
        ne(tasks.status, "canceled"),
      ),
    );

    return {
      buildings: buildingRows
        .map((row) => ({
          id: row.id,
          name: buildingName(row),
          timezone: row.timezone,
          units: unitRows
            .filter((unit) => unit.buildingId === row.id)
            .map(({ id, label }) => ({ id, label }))
            .sort((a, b) => compareUnitLabels(a.label, b.label)),
        }))
        .sort((a, b) => compareUnitLabels(a.name, b.name)),
      tasks: rows.map((row) => toRecord(row, user.id)),
    };
  });
}

/** A building's recurring tasks, and how many of them it finished this year. */
export type RecurringTasks = {
  /** The open occurrence of each recurring task — unscheduled or scheduled. */
  open: TaskRecord[];
  /** Recurring tasks done on this building, every year — the page counts. */
  done: { completedOn: CalendarDate }[];
};

/**
 * `buildingId` is one `getBuilding()` has already found in this org, and the
 * org is filtered on again here all the same. Archived buildings included:
 * their page shows the table read-only.
 */
export async function getRecurringTasks(
  buildingId: string,
): Promise<RecurringTasks> {
  const { db, user } = await getOrgContext();

  return await db.run(async (tx) => {
    const rows = await selectTasks(
      tx,
      and(
        eq(tasks.orgId, db.orgId),
        eq(tasks.buildingId, buildingId),
        isNotNull(tasks.recurrenceMonths),
        ne(tasks.status, "canceled"),
      ),
    );

    return {
      open: rows
        .filter((row) => row.status !== "done")
        .map((row) => toRecord(row, user.id)),
      done: rows
        .filter((row) => row.status === "done" && row.completedOn !== null)
        .map((row) => ({ completedOn: row.completedOn! })),
    };
  });
}
