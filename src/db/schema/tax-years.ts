import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  integer,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { organizations } from "./organizations";

/**
 * An org's settings for one tax year: the blended rate the liability is
 * multiplied by, and the de minimis safe harbor (#144, `docs/data-model.md`
 * §6). The first slice of #44, whose freeze of a filed year lands on this row
 * when it comes.
 *
 * **A year with no row is a year with the defaults**: the threshold at
 * $2,500, elected, and no rate. So nothing writes a row until somebody changes
 * a setting, and the tax planner reads a missing row the same as a new one.
 *
 * **The rate has no default** (#144, decision 2). A liability multiplied by a
 * rate nobody chose is not traceable, so until one is entered the liability
 * card asks for it.
 */
export const taxYears = pgTable(
  "tax_years",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),

    // In basis points: 29% is 2900. Null until somebody enters one.
    blendedRateBps: integer("blended_rate_bps"),
    // Whether the safe harbor is elected for the year, apart from its
    // threshold, so turning it off and on again keeps the figure.
    deMinimisElected: boolean("de_minimis_elected").notNull().default(true),
    // Judged on each item's cost. $2,500 is the limit for a taxpayer without
    // an applicable financial statement, which is every small landlord.
    deMinimisThresholdCents: bigint("de_minimis_threshold_cents", {
      mode: "number",
    })
      .notNull()
      .default(250_000),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One row per org per year, and the index that leads with `org_id`: the
    // planner reads a year by its number.
    unique("tax_years_org_year").on(table.orgId, table.year),
    check("tax_years_year_plausible", sql`${table.year} BETWEEN 2000 AND 2200`),
    check(
      "tax_years_rate_valid",
      sql`${table.blendedRateBps} BETWEEN 0 AND 10000`,
    ),
    check(
      "tax_years_threshold_not_negative",
      sql`${table.deMinimisThresholdCents} >= 0`,
    ),
  ],
);
