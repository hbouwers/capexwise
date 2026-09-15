import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { units } from "./buildings";
import { organizations } from "./organizations";

/**
 * One unit's rent for one month (PRD F1, the rent roll on
 * `docs/ui/screens/building-detail.md`): what was expected, and whether it
 * arrived. `docs/data-model.md` §4 is the prose version of this file.
 *
 * A record of what arrived, not a payment rail, and not a record of who paid
 * it — there is no tenant here, deliberately (§1).
 *
 * Periods open lazily, the first time anybody views the month, through
 * `ensureRentPeriods()` in `src/server/queries/rent-periods.ts` — so a unit
 * nobody looks at accrues no rows, and an un-opened period is not an unpaid
 * one.
 */
export const rentPeriods = pgTable(
  "rent_periods",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Denormalised: derivable through the unit, and stored because the
    // cash-flow tile and the Schedule E both sum by building over a range of
    // months (§4). `rent_periods_unit` below is what keeps it the unit's.
    buildingId: uuid("building_id").notNull(),
    unitId: uuid("unit_id").notNull(),

    // Always the first of the month — `rent_periods_month_is_first`.
    periodMonth: date("period_month").notNull(),
    // **A snapshot of `units.rent_cents`, taken when the period opens**, and
    // never recomputed from it: a rent increase in March must not rewrite
    // January (§4). Editable on the row, for the increase entered late.
    amountExpectedCents: bigint("amount_expected_cents", {
      mode: "number",
    }).notNull(),
    // Null until somebody says it arrived — `Not marked`, never "unpaid".
    amountReceivedCents: bigint("amount_received_cents", { mode: "number" }),
    receivedOn: date("received_on"),
    // The unit stood empty this month, whatever its status is today (#97).
    // The period exists, expects nothing and is left out of both halves of
    // every total. A flag rather than a missing row, because the next view of
    // the month would open the missing row again; and rather than a zero,
    // which would put a month nobody owed in the rent roll's denominator.
    vacant: boolean("vacant").notNull().default(false),
    note: text("note"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // **The unit, its building and its org, in one reference.** The org for
    // `units_building`'s reason — a foreign key is checked past row-level
    // security (§9, fifth item). The building because it is stored here too,
    // and a period whose `building_id` was not its unit's would be summed
    // into the wrong building's income; §4 left that to the isolation test,
    // and a key that names the org already costs what naming the building as
    // well does.
    //
    // `restrict`, per §7: a unit with rent history is retired, never deleted.
    // The building is held by its units in turn, so it needs no key of its own.
    foreignKey({
      name: "rent_periods_unit",
      columns: [table.orgId, table.buildingId, table.unitId],
      foreignColumns: [units.orgId, units.buildingId, units.id],
    }).onDelete("restrict"),
    // One period per unit per month, and what makes opening one safe when two
    // requests race: the second insert conflicts and does nothing (§4). Also
    // §8's `rent_periods_org_unit_month`, led by the org.
    unique("rent_periods_org_unit_month").on(
      table.orgId,
      table.unitId,
      table.periodMonth,
    ),
    // §8. A building's rent roll for a month, and its income over a year.
    index("rent_periods_org_building_month").on(
      table.orgId,
      table.buildingId,
      table.periodMonth,
    ),
    // §8. The months nobody has marked yet — the rent roll's "August has 1
    // unit not marked", and the dashboard's. A vacant month is marked.
    index("rent_periods_org_unmarked")
      .on(table.orgId, table.periodMonth)
      .where(sql`amount_received_cents IS NULL AND NOT vacant`),
    check(
      "rent_periods_month_is_first",
      sql`extract(day from ${table.periodMonth}) = 1`,
    ),
    check(
      "rent_periods_money_not_negative",
      sql`${table.amountExpectedCents} >= 0 AND ${table.amountReceivedCents} >= 0`,
    ),
    // An amount without a date says nothing about lateness, and a date
    // without an amount is not a payment.
    check(
      "rent_periods_received_pair",
      sql`(${table.amountReceivedCents} IS NULL) = (${table.receivedOn} IS NULL)`,
    ),
    // A month nobody owed is a month nobody paid.
    check(
      "rent_periods_vacant_received_nothing",
      sql`NOT ${table.vacant} OR ${table.amountReceivedCents} IS NULL`,
    ),
  ],
);
