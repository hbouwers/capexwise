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
import { capitalItems } from "./capital-items";
import { organizations } from "./organizations";

/**
 * Money out, recorded by hand (`docs/ui/screens/expenses.md`, PRD §12
 * question 5): what was spent, on which building, in which Schedule E
 * category. The other half of the dashboard's cash flow tile, and the records
 * half of the tax planner's statement. `docs/data-model.md` §6 is the prose
 * version of this file.
 *
 * **Two of its references are not here**: the task and the contact. Each is
 * informational, so a delete on the other side nulls it and only it — the
 * reason `tasks` gives for writing its own four by hand. They are in the
 * hand-written migration beside the generated one, with the row-level
 * security, the grants and the `updated_at` trigger.
 */

/**
 * The lines of Schedule E (Form 1040) a recorded expense can land on, as
 * reference data: one list every org reads and only a migration writes, as
 * `trade_tags` is. No `org_id`, and not an omission — the isolation test names
 * it as reference data.
 *
 * **Line 18, depreciation, is not on it.** Depreciation is computed from a
 * basis and a recovery period by the tax planner, never paid out of an account,
 * so there is nothing to record against it.
 */
export const scheduleECategories = pgTable(
  "schedule_e_categories",
  {
    // `repairs`, `mortgage-interest`. Also what `?category=` carries in a
    // URL, so it is held to a shape a URL does not have to escape.
    slug: text("slug").primaryKey(),
    label: text("label").notNull(),
    // The line on the form, which is also the order the list is shown in —
    // the order a CPA reads it.
    line: integer("line").notNull().unique("schedule_e_categories_line"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "schedule_e_categories_slug_format",
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    // Lines 5 through 19 are the expenses. 18 is depreciation, above.
    check(
      "schedule_e_categories_line_is_an_expense",
      sql`${table.line} BETWEEN 5 AND 19 AND ${table.line} <> 18`,
    ),
  ],
);

/**
 * The repair-or-improvement call, on spend already made (PRD F4). A repair
 * comes off the year's income; an improvement is capitalized and depreciated.
 * `unclassified` is somebody saying they have not decided, which the tax
 * planner treats differently from a row it was never asked about — that one is
 * null, and the expense modal only asks for the repairs category and for work
 * on a capital item (`expenses.md`).
 */
export const transactionClassification = pgEnum("transaction_classification", [
  "repair",
  "improvement",
  "unclassified",
]);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // The references are below, and name the org as well (§9, fifth item).
    buildingId: uuid("building_id").notNull(),
    // Null is the building's — a roof, a water bill. A scope, never a
    // boundary.
    unitId: uuid("unit_id"),
    // The equipment the money went on, if any.
    capitalItemId: uuid("capital_item_id"),
    // The job it paid for, if any. Its reference is hand-written.
    taskId: uuid("task_id"),
    // Who was paid, if they are in the contact book. Hand-written too.
    contactId: uuid("contact_id"),

    // A plain date (ADR-0005): the day on the receipt.
    occurredOn: date("occurred_on").notNull(),
    // **Signed**, where every other money column in the schema is a magnitude:
    // negative is money out, positive a refund. A ledger row's direction is
    // part of the fact (§6).
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    description: text("description"),
    // `restrict`, per §7's rule for reference data.
    scheduleECategory: text("schedule_e_category")
      .notNull()
      .references(() => scheduleECategories.slug, { onDelete: "restrict" }),
    classification: transactionClassification("classification"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // `restrict`, per §7: a building with spend recorded against it is
    // archived or sold, not deleted.
    foreignKey({
      name: "transactions_building",
      columns: [table.orgId, table.buildingId],
      foreignColumns: [buildings.orgId, buildings.id],
    }).onDelete("restrict"),
    // The unit, its building and its org, as `tasks_unit` has it. A null unit
    // is the shared case, which a composite key does not check.
    foreignKey({
      name: "transactions_unit",
      columns: [table.orgId, table.buildingId, table.unitId],
      foreignColumns: [units.orgId, units.buildingId, units.id],
    }).onDelete("restrict"),
    // `restrict`, per §7: money spent on an item is part of its record, and a
    // `set null` would lose which furnace the $4,800 went on. Named with the
    // building, so spend cannot land on another building's equipment.
    foreignKey({
      name: "transactions_capital_item",
      columns: [table.orgId, table.buildingId, table.capitalItemId],
      foreignColumns: [
        capitalItems.orgId,
        capitalItems.buildingId,
        capitalItems.id,
      ],
    }).onDelete("restrict"),
    // §8. A building's ledger for a period, and the tax planner's by building.
    index("transactions_org_building_date").on(
      table.orgId,
      table.buildingId,
      table.occurredOn,
    ),
    // §8. The portfolio's ledger for a period, by category.
    index("transactions_org_date_category").on(
      table.orgId,
      table.occurredOn,
      table.scheduleECategory,
    ),
    // A task's expense — what `Mark done` wrote — and what a task's delete
    // has to find to null.
    index("transactions_org_task")
      .on(table.orgId, table.taskId)
      .where(sql`task_id IS NOT NULL`),
    // Zero is not an expense or a refund; it is a row somebody meant to fill
    // in. The modal refuses it, and so does the table.
    check("transactions_amount_not_zero", sql`${table.amountCents} <> 0`),
    // What a reference names when it names the org too (§9, fifth item): the
    // plan an expense carried out (#96).
    unique("transactions_org_and_id").on(table.orgId, table.id),
  ],
);
