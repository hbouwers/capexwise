import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { buildings, units } from "./buildings";
import { tradeTags } from "./contacts";
import { organizations } from "./organizations";

/**
 * Upkeep and one-off jobs (PRD F5, `docs/ui/screens/maintenance.md` and the
 * building page's Recurring tasks). `docs/data-model.md` §6 is the prose
 * version of this file.
 *
 * **Four of its references are not here**: the capital item, the two
 * assignees and the recurrence parent. Each is informational, so a delete on
 * the other side nulls it — and only it. A composite key's `set null` nulls
 * every column in it, `org_id` included, and Drizzle has no way to name the
 * one column Postgres 15 lets `set null` take. So they are written in the
 * hand-written migration beside the generated one, with the row-level
 * security, the grants, the `updated_at` trigger and the rule that a changed
 * date or assignee clears a confirmation.
 */

/**
 * `canceled` is work that will not happen: kept for its history and left out
 * of every task table (§7). A task is never deleted, apart from Undo on a
 * completion taking back the occurrence it wrote.
 */
export const taskStatus = pgEnum("task_status", [
  "unscheduled",
  "scheduled",
  "done",
  "canceled",
]);

/** `High / Normal / Low` on screen — the enum's own words (`maintenance.md`). */
export const taskPriority = pgEnum("task_priority", ["low", "normal", "high"]);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // The references are below, and name the org as well (§9, fifth item).
    buildingId: uuid("building_id").notNull(),
    // Null is the building's — the gutters. A scope, never a boundary.
    unitId: uuid("unit_id"),
    // The equipment the work is on, if any. Its reference is hand-written.
    capitalItemId: uuid("capital_item_id"),

    title: text("title").notNull(),
    notes: text("notes"),
    // One trade, which is enough to find contacts (`maintenance.md`).
    // `restrict`, per §7's rule for reference data.
    tradeTag: text("trade_tag").references(() => tradeTags.slug, {
      onDelete: "restrict",
    }),
    status: taskStatus("status").notNull().default("unscheduled"),
    priority: taskPriority("priority").notNull().default("normal"),
    // Plain dates, with no clock time and no timezone (ADR-0005). "Due today"
    // is today where the building is.
    dueDate: date("due_date"),
    completedOn: date("completed_on"),
    // The day the work was booked with its assignee, null while it awaits
    // confirmation (#93). Cleared by a trigger when the date or the assignee
    // changes.
    confirmedOn: date("confirmed_on"),
    // A vendor — somebody with no account. Its reference is hand-written.
    assigneeContactId: uuid("assignee_contact_id"),
    // A member of the org, through the membership (#94). Hand-written too.
    assigneeUserId: uuid("assignee_user_id"),
    estCostCents: bigint("est_cost_cents", { mode: "number" }),
    // What it did cost. In v1 expense entry is where spend is read from, and
    // this stays the task's own record of it.
    actualCostCents: bigint("actual_cost_cents", { mode: "number" }),

    // Null is a one-off. The rule, not a year of generated rows: completing
    // an occurrence writes the next one, and only that (§6).
    recurrenceMonths: integer("recurrence_months"),
    // The occurrence this one was written by. Hand-written reference.
    recurrenceParentId: uuid("recurrence_parent_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // `restrict`, per §7: a building with tasks is archived, not deleted.
    foreignKey({
      name: "tasks_building",
      columns: [table.orgId, table.buildingId],
      foreignColumns: [buildings.orgId, buildings.id],
    }).onDelete("restrict"),
    // The unit, its building and its org, as `capital_items_unit` has it. A
    // null unit is the shared case, which a composite key does not check.
    foreignKey({
      name: "tasks_unit",
      columns: [table.orgId, table.buildingId, table.unitId],
      foreignColumns: [units.orgId, units.buildingId, units.id],
    }).onDelete("restrict"),
    // What the recurrence parent names: a task, its building and its org.
    // `id` is unique on its own, so this admits no task that was not legal.
    unique("tasks_org_building_and_id").on(
      table.orgId,
      table.buildingId,
      table.id,
    ),
    // §8. Maintenance's tabs and tiles, and the dashboard's two.
    index("tasks_org_status_due").on(table.orgId, table.status, table.dueDate),
    // §8. A building's tasks, across both scopes.
    index("tasks_org_building_unit").on(
      table.orgId,
      table.buildingId,
      table.unitId,
    ),
    // §8. A contact's tasks — its `last used` date — and what a contact's
    // delete has to find.
    index("tasks_org_assignee")
      .on(table.orgId, table.assigneeContactId)
      .where(sql`assignee_contact_id IS NOT NULL`),
    // §8. The same for a member, whose revoked membership unassigns them.
    index("tasks_org_assignee_user")
      .on(table.orgId, table.assigneeUserId)
      .where(sql`assignee_user_id IS NOT NULL`),
    // §8. The occurrence a completion wrote, which its Undo removes.
    index("tasks_org_recurrence_parent")
      .on(table.orgId, table.recurrenceParentId)
      .where(sql`recurrence_parent_id IS NOT NULL`),
    check(
      "tasks_money_not_negative",
      sql`${table.estCostCents} >= 0 AND ${table.actualCostCents} >= 0`,
    ),
    check("tasks_recurrence_positive", sql`${table.recurrenceMonths} > 0`),
    // A booked task has a day; a done one says when it was done.
    check(
      "tasks_scheduled_has_date",
      sql`${table.status} <> 'scheduled' OR ${table.dueDate} IS NOT NULL`,
    ),
    check(
      "tasks_done_has_date",
      sql`${table.status} <> 'done' OR ${table.completedOn} IS NOT NULL`,
    ),
    // A vendor or a member, never both (#94).
    check(
      "tasks_one_assignee",
      sql`${table.assigneeContactId} IS NULL OR ${table.assigneeUserId} IS NULL`,
    ),
    // Confirmed means booked with somebody for a day (#93): an unscheduled
    // task has no day, and an unassigned one nobody to book it with. A done
    // task keeps its confirmation, as history.
    check(
      "tasks_confirmed_is_booked",
      sql`${table.confirmedOn} IS NULL OR (
        ${table.status} IN ('scheduled', 'done')
        AND (${table.assigneeContactId} IS NOT NULL OR ${table.assigneeUserId} IS NOT NULL)
      )`,
    ),
    check(
      "tasks_not_its_own_parent",
      sql`${table.recurrenceParentId} <> ${table.id}`,
    ),
  ],
);
