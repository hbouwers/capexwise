import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { buildings, units } from "./buildings";
import { contacts } from "./contacts";
import { organizations } from "./organizations";

/**
 * A building's operational facts (PRD F1, `docs/ui/screens/building-detail.md`,
 * the Building facts card): its collection days, its utilities and services,
 * and the codes that open it. `docs/data-model.md` §3 is the prose version of
 * this file.
 *
 * Three tables rather than one wide row, for reasons §3 gives: a duplex has two
 * electric accounts and one water main, which columns cannot hold, and the
 * codes are sealed, revealed one at a time and rotated per row.
 *
 * Every reference to another org's table names the org as well as the row —
 * `units_building`'s shape and §9's fifth checklist item — because a foreign
 * key is checked past row-level security.
 */

/** `mon` … `sun`, as `building_facts`' two day columns hold them. */
export const WEEKDAYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;

/**
 * One row per building, or none until somebody records a day. Its key is the
 * building's, led by the org as every index on a domain table is (§8) —
 * `building_id` is unique on its own, so the pair admits exactly the rows the
 * building alone would.
 */
export const buildingFacts = pgTable(
  "building_facts",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // The reference itself is `building_facts_building` below.
    buildingId: uuid("building_id").notNull(),

    trashDay: text("trash_day", { enum: WEEKDAYS }),
    recyclingDay: text("recycling_day", { enum: WEEKDAYS }),
    // "every other week, odd weeks" — the schedule a day cannot say.
    recyclingNote: text("recycling_note"),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "building_facts_pkey",
      columns: [table.orgId, table.buildingId],
    }),
    // The facts are the building's, and go with it — the typo case in §7,
    // a building deleted before anything else hangs off it.
    foreignKey({
      name: "building_facts_building",
      columns: [table.orgId, table.buildingId],
      foreignColumns: [buildings.orgId, buildings.id],
    }).onDelete("cascade"),
    check(
      "building_facts_trash_day_known",
      sql`${table.trashDay} IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')`,
    ),
    check(
      "building_facts_recycling_day_known",
      sql`${table.recyclingDay} IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')`,
    ),
  ],
);

/**
 * What serves a building. A native enum, because the set is *defined* — the
 * PRD's utilities and the two services the facts card lists beside them — and
 * `other` covers the rest (§1).
 */
export const utilityKind = pgEnum("utility_kind", [
  "gas",
  "electric",
  "water_sewer",
  "internet",
  "trash",
  "lawn",
  "snow",
  "other",
]);

export const PAID_BY = ["owner", "tenant"] as const;

export const buildingUtilities = pgTable(
  "building_utilities",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // The references are `building_utilities_building`, `_unit` and
    // `_contact` below, each naming the org as well.
    buildingId: uuid("building_id").notNull(),
    // Null is the whole building; a unit's own meter names the unit.
    unitId: uuid("unit_id"),
    kind: utilityKind("kind").notNull(),
    providerName: text("provider_name"),
    // The last four characters of the account number, which a utility prints
    // on every bill — never the number itself. A stub by design, so not sealed
    // (ADR-0008), and the check below is what keeps it a stub.
    accountRef: text("account_ref"),
    // What makes the owner-paid subtotal computable rather than typed.
    paidBy: text("paid_by", { enum: PAID_BY }).notNull().default("owner"),
    avgMonthlyCents: bigint("avg_monthly_cents", { mode: "number" }),
    // The lawn crew, the plow — the person to call, from the contact book.
    contactId: uuid("contact_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "building_utilities_building",
      columns: [table.orgId, table.buildingId],
      foreignColumns: [buildings.orgId, buildings.id],
    }).onDelete("cascade"),
    // `restrict`, as §3 has it: a unit with an account on it is not removed
    // until the account has somewhere else to be. A composite key with a null
    // in it is not checked, which is the building-wide row, correctly.
    foreignKey({
      name: "building_utilities_unit",
      columns: [table.orgId, table.unitId],
      foreignColumns: [units.orgId, units.id],
    }).onDelete("restrict"),
    // `restrict`, not §3's first `set null`. A contact is archived rather than
    // deleted (§7), and a true delete is only for one nothing references —
    // which this enforces. And `set null` on a composite key nulls every
    // column in it, the org included, which `org_id`'s `not null` refuses.
    foreignKey({
      name: "building_utilities_contact",
      columns: [table.orgId, table.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete("restrict"),
    // §8. The facts card reads a building's utilities.
    index("building_utilities_org_building").on(table.orgId, table.buildingId),
    check(
      "building_utilities_account_ref_is_a_stub",
      sql`char_length(${table.accountRef}) <= 4`,
    ),
    check(
      "building_utilities_paid_by_known",
      sql`${table.paidBy} IN ('owner', 'tenant')`,
    ),
    check(
      "building_utilities_avg_not_negative",
      sql`${table.avgMonthlyCents} >= 0`,
    ),
  ],
);

export const accessCodeKind = pgEnum("access_code_kind", [
  "smart_lock",
  "door",
  "lockbox",
  "garage",
  "gate",
  "other",
]);

/**
 * `bytea`, which Drizzle 0.45 has no column for. The driver reads one back as a
 * `Buffer` and writes a `Buffer` as one, so the type is all this adds.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * The codes that open a building, sealed. ADR-0008 is the scheme and
 * `src/lib/access-code-cipher.mts` the only code that holds one in plaintext.
 *
 * **Nothing in this table is ever logged**, including in an error that
 * serialises the row, and no query that renders a page selects `secret`.
 */
export const buildingAccessCodes = pgTable(
  "building_access_codes",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    buildingId: uuid("building_id").notNull(),
    // Null is the building's; a unit's own door names the unit.
    unitId: uuid("unit_id"),
    kind: accessCodeKind("kind").notNull(),
    // "Rear door", "Basement lockbox".
    label: text("label"),
    // The IV, one sealed block and the tag. `bytea` rather than `text`, so a
    // plaintext typed in during a debug session is refused by the length
    // check below rather than stored (§3).
    secret: bytea("secret").notNull(),
    // Which `ACCESS_CODE_KEYS` version sealed it, so a rotation can find the
    // rows still under an old key.
    keyVersion: integer("key_version").notNull(),
    // When the code at the lock last changed — not the key. A rotation does
    // not touch it.
    lastRotatedAt: timestamp("last_rotated_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "building_access_codes_building",
      columns: [table.orgId, table.buildingId],
      foreignColumns: [buildings.orgId, buildings.id],
    }).onDelete("cascade"),
    // `cascade`, as §3 has it: a code to a unit that no longer exists opens
    // nothing, and §7 keeps no ciphertext for a lock that is gone.
    foreignKey({
      name: "building_access_codes_unit",
      columns: [table.orgId, table.unitId],
      foreignColumns: [units.orgId, units.id],
    }).onDelete("cascade"),
    // §8. The facts card lists a building's codes.
    index("building_access_codes_org_building").on(
      table.orgId,
      table.buildingId,
    ),
    // `SEALED_BYTES` in the cipher: every secret is exactly this long, so
    // anything else was not written by it.
    check(
      "building_access_codes_secret_is_sealed",
      sql`octet_length(${table.secret}) = 92`,
    ),
    check(
      "building_access_codes_key_version_positive",
      sql`${table.keyVersion} > 0`,
    ),
  ],
);
