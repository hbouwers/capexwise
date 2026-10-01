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
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { buildings, units } from "./buildings";
import { organizations } from "./organizations";

/**
 * The things a building wears out — furnaces, roofs, refrigerators — and the
 * catalogue their defaults come from (PRD F2). The forecast is built from these
 * rows, and the tax planner's depreciation from their install years and costs.
 * `docs/data-model.md` §5 is the prose version of this file.
 *
 * Row-level security, the grants, the `updated_at` triggers, the rule that an
 * explicit split sums to the whole, and the catalogue itself are in the
 * hand-written migrations beside the generated one: Drizzle models none of
 * them.
 */

/**
 * The add-equipment checklist's five groups, in the order it shows them
 * (`docs/ui/screens/modal-add-equipment.md`).
 */
export const CAPITAL_ITEM_GROUPS = [
  "kitchen",
  "laundry",
  "hvac_water",
  "envelope",
  "interior_systems",
] as const;

/**
 * Where the checklist proposes an item goes: one per unit, or one for the
 * building. A proposal — the person picks per item (PRD F2), and HVAC & water
 * is where the proposal is most often wrong.
 */
export const CAPITAL_ITEM_SCOPES = ["building", "unit"] as const;

/**
 * Which depreciation schedule an item recovers over (#144): `residential` is
 * 27.5 years mid-month, a building's structural components; `five_year` is
 * appliances and carpet, 5 years half-year. `RecoveryClass` in
 * `src/lib/tax/depreciation.ts` spells the same two values.
 */
export const RECOVERY_CLASSES = ["residential", "five_year"] as const;

/**
 * The catalogue, as reference data: one list every org reads and only a
 * migration writes, like `trade_tags` (§6). No `org_id`, and the isolation
 * test names it as reference data.
 *
 * **Its defaults are copied onto an item when the item is added**, and never
 * read from here again — so refreshing a life or a cost in a later migration
 * moves nobody's numbers (§5). `defaults_updated_at` is what the add-equipment
 * modal shows as the defaults' age, PRD §11's staleness signal.
 */
export const capitalItemTypes = pgTable(
  "capital_item_types",
  {
    // `furnace-gas`, `roof-asphalt`. Held to the shape `trade_tags` is, so
    // it can sit in a URL unescaped.
    slug: text("slug").primaryKey(),
    label: text("label").notNull(),
    // A `text` with a check rather than a native enum, as §5 has it: a sixth
    // group is a one-line migration, not an enum value that can never be
    // taken back.
    itemGroup: text("item_group", { enum: CAPITAL_ITEM_GROUPS }).notNull(),
    defaultScope: text("default_scope", {
      enum: CAPITAL_ITEM_SCOPES,
    }).notNull(),
    defaultLifeYears: integer("default_life_years").notNull(),
    // A national figure, for one unit's worth of a unit-scoped item and a
    // small building's worth of a building-scoped one. The migration that
    // seeds it says where each came from.
    defaultCostCents: bigint("default_cost_cents", {
      mode: "number",
    }).notNull(),
    // When the life and cost were last checked against their sources — a
    // date, not a timestamp, because it is a claim about the figures and not
    // about the row.
    defaultsUpdatedAt: date("defaults_updated_at").notNull(),
    // The tax planner's schedule for the type. **Read from here, not copied
    // onto the item** as the defaults are: it is a classification the law
    // makes, not an estimate somebody corrects, so a migration that fixes one
    // should move every item of the type. No default, so a new type has to
    // say which it is.
    recoveryClass: text("recovery_class", {
      enum: RECOVERY_CLASSES,
    }).notNull(),
    // The catalogue's order, across groups, in steps of ten so a type added
    // later can land between two.
    sortOrder: integer("sort_order").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "capital_item_types_slug_format",
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check(
      "capital_item_types_group_known",
      sql`${table.itemGroup} IN ('kitchen', 'laundry', 'hvac_water', 'envelope', 'interior_systems')`,
    ),
    check(
      "capital_item_types_scope_known",
      sql`${table.defaultScope} IN ('building', 'unit')`,
    ),
    check(
      "capital_item_types_recovery_class_known",
      sql`${table.recoveryClass} IN ('residential', 'five_year')`,
    ),
    check(
      "capital_item_types_life_positive",
      sql`${table.defaultLifeYears} > 0`,
    ),
    check(
      "capital_item_types_cost_not_negative",
      sql`${table.defaultCostCents} >= 0`,
    ),
  ],
);

/**
 * ADR-0005: a precise install date is a claim about knowledge, not a
 * formatting choice. `estimated` is a year somebody guessed — every item the
 * checklist adds starts here — and `audited` is one read off a label or an
 * invoice, which is why it carries a date.
 */
export const itemConfidence = pgEnum("item_confidence", [
  "estimated",
  "audited",
]);

/**
 * `replaced` is an item a newer row took over from (`replaced_by_id`), and
 * `removed` is one that is gone and was not replaced. Both leave the forecast
 * and keep their history — neither is a delete (§7).
 */
export const itemStatus = pgEnum("item_status", [
  "active",
  "replaced",
  "removed",
]);

/**
 * How a shared item's cost divides across the building's units (§5). Stored
 * as a rule, not a number, and applied when read — `allocateCapitalItem()` in
 * `src/lib/capital-items.ts`:
 *
 * - `by_unit_count`: evenly across the non-retired units, by largest remainder.
 * - `building_only`: not divided. The only value a unit-scoped item may have,
 *   since its unit already says whose it is.
 * - `explicit`: the shares in `capital_item_allocations`, which sum to 10000.
 */
export const allocationMethod = pgEnum("allocation_method", [
  "building_only",
  "by_unit_count",
  "explicit",
]);

export const capitalItems = pgTable(
  "capital_items",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // The references themselves are below, and name the org as well (§9,
    // fifth item).
    buildingId: uuid("building_id").notNull(),
    // Null is the building's — the roof, the gutters. A scope, never a
    // boundary: a shared row is as much the org's as a unit's is.
    unitId: uuid("unit_id"),

    // The catalogue entry it was added from, or null for something the
    // catalogue does not list. `restrict`, per §7's rule for reference data.
    typeSlug: text("type_slug").references(() => capitalItemTypes.slug, {
      onDelete: "restrict",
    }),
    // Copied from the type when the item is added, then the person's to edit.
    label: text("label").notNull(),

    // Required: an item with no year cannot be aged, and every item the
    // checklist adds arrives with an estimate. Loosening this later is one
    // statement; tightening it after rows without a year exist would not be.
    installYear: integer("install_year").notNull(),
    // Only when audited, and always inside `install_year`.
    installDate: date("install_date"),
    confidence: itemConfidence("confidence").notNull().default("estimated"),
    // Copied from the type at add time, like the cost below, so a refreshed
    // catalogue moves nobody's forecast (§5).
    expectedLifeYears: integer("expected_life_years").notNull(),
    // What replacing it will cost — the forecast's figure.
    replacementCostCents: bigint("replacement_cost_cents", {
      mode: "number",
    }).notNull(),
    // What installing it did cost, when known — the tax planner's basis.
    actualCostCents: bigint("actual_cost_cents", { mode: "number" }),
    status: itemStatus("status").notNull().default("active"),
    allocation: allocationMethod("allocation")
      .notNull()
      .default("by_unit_count"),
    // The row that took over when this one was replaced. Set with `status =
    // 'replaced'`, and only then — `capital_items_replaced_by_set`.
    replacedById: uuid("replaced_by_id"),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The building and its org, for `units_building`'s reason. `restrict`,
    // per §7: a building with equipment is archived, not deleted.
    foreignKey({
      name: "capital_items_building",
      columns: [table.orgId, table.buildingId],
      foreignColumns: [buildings.orgId, buildings.id],
    }).onDelete("restrict"),
    // **The unit, its building and its org**, as `rent_periods_unit` has it:
    // a unit-scoped item whose unit was in another building would be counted
    // toward the wrong building's forecast. Null for a shared item, and a
    // composite key with a null in it is not checked — which is the shared
    // case, correctly. `restrict`: a unit with equipment is retired (§7).
    foreignKey({
      name: "capital_items_unit",
      columns: [table.orgId, table.buildingId, table.unitId],
      foreignColumns: [units.orgId, units.buildingId, units.id],
    }).onDelete("restrict"),
    // What a replacement and an allocation point at: an item, its building
    // and its org. `id` is unique on its own, so this admits no row that was
    // not already legal.
    unique("capital_items_org_building_and_id").on(
      table.orgId,
      table.buildingId,
      table.id,
    ),
    // **A replacement is in the same building as what it replaced.**
    // `restrict` rather than §5's first `set null`: nulling it would leave a
    // `replaced` row with nothing replacing it, which the check below refuses
    // anyway — and `set null` on a composite key nulls `org_id` too. Undoing
    // a replacement puts the old row back before removing the new one.
    foreignKey({
      name: "capital_items_replaced_by",
      columns: [table.orgId, table.buildingId, table.replacedById],
      foreignColumns: [table.orgId, table.buildingId, table.id],
    }).onDelete("restrict"),
    // §8. The forecast and the building's page read every item of a
    // building, shared and unit-scoped together.
    index("capital_items_org_building_unit").on(
      table.orgId,
      table.buildingId,
      table.unitId,
    ),
    // §8. The portfolio's forecast: an org's active items, by age.
    index("capital_items_org_status_year").on(
      table.orgId,
      table.status,
      table.installYear,
    ),
    check(
      "capital_items_install_year_plausible",
      sql`${table.installYear} BETWEEN 1600 AND 2200`,
    ),
    // An audited item says when, to the day. ADR-0005.
    check(
      "capital_items_audited_has_date",
      sql`${table.confidence} = 'estimated' OR ${table.installDate} IS NOT NULL`,
    ),
    // A date and a year that disagree are two answers to one question.
    check(
      "capital_items_install_date_in_year",
      sql`${table.installDate} IS NULL
        OR extract(year FROM ${table.installDate}) = ${table.installYear}`,
    ),
    check("capital_items_life_positive", sql`${table.expectedLifeYears} > 0`),
    check(
      "capital_items_money_not_negative",
      sql`${table.replacementCostCents} >= 0 AND ${table.actualCostCents} >= 0`,
    ),
    // Allocation only means something for a shared item: a unit-scoped
    // item's unit already says whose it is.
    check(
      "capital_items_allocation_scope",
      sql`${table.unitId} IS NULL OR ${table.allocation} = 'building_only'`,
    ),
    // `replaced` and a successor come together. A replacement is a new row
    // (§5), so a replaced item with no row after it is a replacement nobody
    // recorded, and a successor on an active item is an edit pretending to be
    // one.
    check(
      "capital_items_replaced_by_set",
      sql`(${table.status} = 'replaced') = (${table.replacedById} IS NOT NULL)`,
    ),
    check(
      "capital_items_not_its_own_replacement",
      sql`${table.replacedById} <> ${table.id}`,
    ),
  ],
);

/**
 * An explicit split: each unit's share of a shared item, in basis points. Only
 * an item whose `allocation` is `explicit` has rows here, and its rows sum to
 * 10000 — both held by a deferred trigger in the hand-written migration, since
 * no check constraint can see more than one row.
 *
 * Basis points rather than a fraction, because integers sum exactly and a
 * hundredth of a percent is finer than any split a landlord will defend to a
 * CPA (§5).
 */
export const capitalItemAllocations = pgTable(
  "capital_item_allocations",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Denormalised, like `rent_periods.building_id`: it is what lets both
    // references below name the building, so a share cannot go to a unit in
    // another building from the item's.
    buildingId: uuid("building_id").notNull(),
    capitalItemId: uuid("capital_item_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    shareBps: integer("share_bps").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Led by `org_id`, as `contact_tags_pkey` is, and it is §8's
    // `capital_item_allocations_org_item` as well: an item's shares are one
    // range of it. One row per unit per item.
    primaryKey({
      name: "capital_item_allocations_pkey",
      columns: [table.orgId, table.capitalItemId, table.unitId],
    }),
    // The item, its building and its org. The shares go with their item.
    foreignKey({
      name: "capital_item_allocations_item",
      columns: [table.orgId, table.buildingId, table.capitalItemId],
      foreignColumns: [
        capitalItems.orgId,
        capitalItems.buildingId,
        capitalItems.id,
      ],
    }).onDelete("cascade"),
    // The unit, the same building and the org. `restrict` rather than §5's
    // first `cascade`: a cascade would take one share out of a split and
    // leave the rest summing to less than the whole, which the sum rule then
    // refuses at commit — a unit with a share is retired instead (§7).
    foreignKey({
      name: "capital_item_allocations_unit",
      columns: [table.orgId, table.buildingId, table.unitId],
      foreignColumns: [units.orgId, units.buildingId, units.id],
    }).onDelete("restrict"),
    check(
      "capital_item_allocations_share_in_range",
      sql`${table.shareBps} BETWEEN 0 AND 10000`,
    ),
  ],
);
