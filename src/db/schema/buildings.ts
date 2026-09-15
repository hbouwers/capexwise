import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { organizations } from "./organizations";

/**
 * A building is the address; a unit is a separately-leased space inside it
 * (`CLAUDE.md`, #48). Two duplexes are two buildings and four units. Every
 * other domain record hangs off one of the two, which is why they are the first
 * domain tables. `docs/data-model.md` §3 is the prose version of this file.
 *
 * Row-level security, the grants and the `updated_at` triggers are in the
 * hand-written migration beside the generated one, as they are for every table
 * before these: Drizzle models none of them. §9 is the template.
 */

/**
 * `sold` is #43's, which records the sale. `archived` is the building form's
 * way out of the portfolio's figures that keeps the history, and the only way
 * to remove a building that has anything attached to it (§7).
 */
export const buildingStatus = pgEnum("building_status", [
  "active",
  "sold",
  "archived",
]);

/**
 * How the purchase price was divided between land and building. A `text` with
 * a check rather than a native enum, as §3 has it: the three values are the
 * ones the form offers today, and a fourth source of a split — a cost
 * segregation study, say — is a one-line migration rather than an enum value
 * that can never be removed again.
 */
export const BASIS_SPLIT_METHODS = [
  "assessment_ratio",
  "appraisal",
  "manual",
] as const;

export const buildings = pgTable(
  "buildings",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    // "The Elm Street duplex". Optional: when it is empty the street address is
    // the building's name everywhere it appears.
    label: text("label"),
    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city: text("city").notNull(),
    // The state, as text rather than a two-letter check: the schema does not
    // assume the US, and §10 leaves constraining it to whichever feature first
    // needs to reason about a state.
    region: text("region").notNull(),
    postalCode: text("postal_code").notNull(),
    country: text("country").notNull().default("US"),
    // An IANA name. ADR-0005: "today" and every due date are the building's,
    // not the viewer's, so this is required rather than defaulted — a default
    // would be somebody's zone, silently.
    timezone: text("timezone").notNull(),

    buildYear: integer("build_year"),
    status: buildingStatus("status").notNull().default("active"),

    // Acquisition and basis (#9, #43). In from the start: depreciation applies
    // to the building portion only, so without the split every figure in F4 is
    // wrong in year one. `buildings_basis_complete` below keeps it whole.
    acquiredOn: date("acquired_on"),
    // When the building was placed in service, which is when depreciation
    // starts — not always the day it was bought.
    inServiceOn: date("in_service_on"),
    purchasePriceCents: bigint("purchase_price_cents", { mode: "number" }),
    // The capitalised portion only — not prepaid taxes, insurance or interest.
    // The basis constraint adds it to the price, which is why the form asks for
    // it by that name (§3).
    closingCostsCents: bigint("closing_costs_cents", { mode: "number" }),
    landBasisCents: bigint("land_basis_cents", { mode: "number" }),
    buildingBasisCents: bigint("building_basis_cents", { mode: "number" }),
    basisSplitMethod: text("basis_split_method", {
      enum: BASIS_SPLIT_METHODS,
    }),
    // Where the split came from — "2026 Marion County assessment, 18% land".
    // The traceability rule, in one field.
    basisSplitNote: text("basis_split_note"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // What a child row's composite reference points at. `id` alone is already
    // unique, so this changes nothing about which buildings can exist; it is
    // there so `units` can reference a building *and its org* in one foreign
    // key — `units_building` below says why that matters.
    unique("buildings_org_and_id").on(table.orgId, table.id),
    // §8. The portfolio lists an org's active buildings.
    index("buildings_org_status").on(table.orgId, table.status),
    check(
      "buildings_build_year_plausible",
      sql`${table.buildYear} BETWEEN 1600 AND 2200`,
    ),
    check(
      "buildings_money_not_negative",
      sql`${table.purchasePriceCents} >= 0 AND ${table.closingCostsCents} >= 0
        AND ${table.landBasisCents} >= 0 AND ${table.buildingBasisCents} >= 0`,
    ),
    check(
      "buildings_basis_split_method_known",
      sql`${table.basisSplitMethod} IN ('assessment_ratio', 'appraisal', 'manual')`,
    ),
    // The most opinionated line in the schema (§3). Either the whole basis is
    // present and adds up, or none of it is. A price with no land split would
    // silently depreciate land — wrong, and invisible — so the tax page gets to
    // say "basis not entered" instead of producing a number nobody can check.
    check(
      "buildings_basis_complete",
      sql`(${table.purchasePriceCents} IS NULL AND ${table.landBasisCents} IS NULL
          AND ${table.buildingBasisCents} IS NULL)
        OR (${table.purchasePriceCents} IS NOT NULL AND ${table.landBasisCents} IS NOT NULL
          AND ${table.buildingBasisCents} IS NOT NULL
          AND ${table.landBasisCents} + ${table.buildingBasisCents}
            = ${table.purchasePriceCents} + coalesce(${table.closingCostsCents}, 0))`,
    ),
  ],
);

/**
 * `retired` is a unit that stopped being a separate leasable space — two
 * studios merged, a unit turned into storage — and keeps its history rather
 * than being deleted (§3, §7).
 */
export const unitStatus = pgEnum("unit_status", [
  "occupied",
  "vacant",
  "retired",
]);

export const units = pgTable(
  "units",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // The reference itself is `units_building` below, which names the org as
    // well as the building.
    buildingId: uuid("building_id").notNull(),

    // "A", "Unit 2", "Upstairs".
    label: text("label").notNull(),
    status: unitStatus("status").notNull().default("vacant"),
    // The current rent and nothing else. A rent period snapshots it when the
    // period opens and never reads it again, so a March increase cannot
    // rewrite January (§4).
    rentCents: bigint("rent_cents", { mode: "number" }),
    leaseEnd: date("lease_end"),
    // Not money, so not cents, and 1.5 is a real answer. Read back as a string
    // — Drizzle's default for `numeric` — so nothing rounds it on the way.
    bedrooms: numeric("bedrooms", { precision: 3, scale: 1 }),
    bathrooms: numeric("bathrooms", { precision: 3, scale: 1 }),
    squareFeet: integer("square_feet"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // **The building and its org, in one reference**, and the reason this is
    // not the plain `building_id references buildings (id)` §3 once had.
    // Postgres checks a foreign key past row-level security, so a scoped
    // handle for org A that cannot *see* org B's building can still insert a
    // unit pointing at it, if it has the id — measured, not assumed. The
    // policy's `with check` only asks whether the new row's `org_id` is A's,
    // and it is. Naming the org in the reference makes the cross-org row one
    // the database cannot hold, whatever the application forgets to check.
    //
    // `restrict`, per §7: a building with units is archived, not deleted.
    foreignKey({
      name: "units_building",
      columns: [table.orgId, table.buildingId],
      foreignColumns: [buildings.orgId, buildings.id],
    }).onDelete("restrict"),
    // What a unit-scoped row's composite reference points at — a utility or a
    // code names its unit and its org, for `buildings_org_and_id`'s reason.
    unique("units_org_and_id").on(table.orgId, table.id),
    // Also §8's `units_org_building`: a unique constraint is a btree, and one
    // led by `(org_id, building_id)` serves every query that index would —
    // the same reasoning as `memberships_org_user`. Named, so a violation says
    // which rule it broke.
    unique("units_org_building_label").on(
      table.orgId,
      table.buildingId,
      table.label,
    ),
    // §8. "Leases ending soon", across the org — occupied units only, because
    // a lease date on a vacant unit is history, not a deadline.
    index("units_org_lease_end")
      .on(table.orgId, table.leaseEnd)
      .where(sql`status = 'occupied'`),
    check("units_rent_not_negative", sql`${table.rentCents} >= 0`),
  ],
);
