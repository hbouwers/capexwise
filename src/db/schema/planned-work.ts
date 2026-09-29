import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { buildings, units } from "./buildings";
import { capitalItems } from "./capital-items";
import { organizations } from "./organizations";
import { transactionClassification } from "./transactions";

/**
 * Where a plan is. `planned` is live: the forecast reads its year and the tax
 * planner its classification. `done` is carried out, and `dropped` is given up
 * on. Both of those are history, kept rather than deleted, so "we planned the
 * roof for 2026 and did it in 2027" stays answerable (#96).
 */
export const plannedWorkStatus = pgEnum("planned_work_status", [
  "planned",
  "done",
  "dropped",
]);

/**
 * Capital work somebody has **chosen** to do in a year, and how they mean to
 * classify it (#96, `docs/data-model.md` §5). It covers what
 * `capital_items.install_year + expected_life_years` cannot. That sum is a
 * projection, and `transactions.classification` is for money already spent.
 *
 * **A row of its own, not columns on the item**, for two reasons:
 * - A discretionary project, a remodel that replaces no tracked item, is PRD
 *   F4's timing lever, and has nowhere else to go.
 * - A plan that is carried out or dropped keeps its row.
 *
 * `planned_work_one_live_plan` keeps the columns' one advantage: an item has
 * at most one live plan.
 *
 * **One reference is not here**, the expense that carried it out. It is
 * `set null` of its one column, which Drizzle cannot say, and is in the
 * hand-written migration beside the generated one, as `transactions`' task is.
 */
export const plannedWork = pgTable(
  "planned_work",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // The references are below, and name the org as well (§9, fifth item).
    buildingId: uuid("building_id").notNull(),
    // A discretionary project's unit, when it is one unit's. A plan for an
    // item has none of its own: the item's scope is its scope.
    unitId: uuid("unit_id"),
    // The item whose next replacement this is. Null is a discretionary
    // project.
    capitalItemId: uuid("capital_item_id"),
    // A discretionary project's name and cost. A plan for an item takes both
    // from the item, so they cannot drift apart from it.
    title: text("title"),
    estCostCents: bigint("est_cost_cents", { mode: "number" }),

    plannedYear: integer("planned_year").notNull(),
    // The month inside the year, when somebody has said (#144). Null is a
    // plan known only by its year, which the tax planner puts into service in
    // July and says so. The forecast reads years and ignores it.
    plannedMonth: integer("planned_month"),
    // `transactions`' enum, so the call copies onto the expense unchanged.
    classification: transactionClassification("classification")
      .notNull()
      .default("unclassified"),
    status: plannedWorkStatus("status").notNull().default("planned"),
    // The expense that carried it out, if one did. Hand-written, above.
    transactionId: uuid("transaction_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // `restrict`, per §7: a building with plans against it is archived or
    // sold, not deleted.
    foreignKey({
      name: "planned_work_building",
      columns: [table.orgId, table.buildingId],
      foreignColumns: [buildings.orgId, buildings.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "planned_work_unit",
      columns: [table.orgId, table.buildingId, table.unitId],
      foreignColumns: [units.orgId, units.buildingId, units.id],
    }).onDelete("restrict"),
    // **`cascade`**, where every other reference to an item restricts. The
    // add-equipment Undo is the only delete of an item, and it takes back a
    // batch added seconds ago. A plan made in those seconds has no history
    // worth keeping. Named with the building, so a plan cannot land on
    // another building's equipment.
    foreignKey({
      name: "planned_work_capital_item",
      columns: [table.orgId, table.buildingId, table.capitalItemId],
      foreignColumns: [
        capitalItems.orgId,
        capitalItems.buildingId,
        capitalItems.id,
      ],
    }).onDelete("cascade"),
    // One live plan per item. A partial index, so any number of done and
    // dropped plans stay as history.
    uniqueIndex("planned_work_one_live_plan")
      .on(table.orgId, table.capitalItemId)
      .where(sql`status = 'planned' AND capital_item_id IS NOT NULL`),
    // §8. The live plans of a building, by year: the forecast's and the tax
    // planner's read.
    index("planned_work_org_building_year")
      .on(table.orgId, table.buildingId, table.plannedYear)
      .where(sql`status = 'planned'`),
    // The plan an expense carried out, when that expense is deleted.
    index("planned_work_org_transaction")
      .on(table.orgId, table.transactionId)
      .where(sql`transaction_id IS NOT NULL`),
    check(
      "planned_work_year_plausible",
      sql`${table.plannedYear} BETWEEN 2000 AND 2200`,
    ),
    // An item's plan takes its name, cost and scope from the item. A
    // discretionary project has only its own, so it must have them.
    check(
      "planned_work_item_or_project",
      sql`(${table.capitalItemId} IS NOT NULL
          AND ${table.title} IS NULL
          AND ${table.estCostCents} IS NULL
          AND ${table.unitId} IS NULL)
        OR (${table.capitalItemId} IS NULL
          AND ${table.title} IS NOT NULL
          AND ${table.estCostCents} IS NOT NULL)`,
    ),
    check(
      "planned_work_month_valid",
      sql`${table.plannedMonth} BETWEEN 1 AND 12`,
    ),
    check("planned_work_cost_not_negative", sql`${table.estCostCents} >= 0`),
    // Only a plan that was carried out points at the expense that did it.
    check(
      "planned_work_transaction_when_done",
      sql`${table.status} = 'done' OR ${table.transactionId} IS NULL`,
    ),
  ],
);
