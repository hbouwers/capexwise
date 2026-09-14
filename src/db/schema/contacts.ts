import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { organizations } from "./organizations";

/**
 * The contact book (PRD F6, `docs/ui/screens/contacts.md`): the org's vendors
 * and professionals, each tagged with the trades they cover, and reusable
 * across every building. `docs/data-model.md` §6 is the prose version of this
 * file. They come before building facts and tasks because both point at a
 * contact — a utility's provider, a task's assignee.
 *
 * Row-level security, the grants, the `updated_at` triggers and the trade list
 * itself are in the hand-written migrations beside the generated one: Drizzle
 * models none of them.
 */

/**
 * The trades, as reference data: one list every org reads and only a
 * migration writes. No `org_id`, and not an omission — the isolation test
 * names it as reference data, and §9 says why it is outside the boundary.
 *
 * A table rather than a native enum because the set is *current* rather than
 * *defined* (§1): a twentieth trade is a row in a migration, where an enum
 * value would be a type change that can never be taken back.
 */
export const tradeTags = pgTable(
  "trade_tags",
  {
    // `hvac`, `snow-removal`. Also what `?trade=` carries in a URL, so it is
    // held to a shape a URL does not have to escape.
    slug: text("slug").primaryKey(),
    label: text("label").notNull(),
    // The PRD's order — the trades first, then the professionals — in steps of
    // ten, so a trade added later can land between two without renumbering.
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
      "trade_tags_slug_format",
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    // Other people's personal data, every one of these — never logged,
    // including in a failed save's error (`CLAUDE.md`).
    name: text("name").notNull(),
    company: text("company"),
    // As typed. A phone number is formatted by whoever wrote it down, and the
    // card's `tel:` link is built from its digits rather than from a stored
    // canonical form nobody entered.
    phone: text("phone"),
    email: text("email"),
    // What they charge, in their own terms — `$75 / hr`, `Bid basis`,
    // `8% of gross` (#95). Free text: the examples are in three different
    // units, and nothing computes with it.
    rateNote: text("rate_note"),
    notes: text("notes"),
    // Archive, not delete (§7): a contact on a past task stays on it, and
    // leaves the book and the assignee lists. One of the two soft deletes in
    // the schema, and §7 says why there are only two.
    archivedAt: timestamp("archived_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // What `contact_tags_contact` references, for the reason
    // `buildings_org_and_id` gives: a child names its parent's org as well
    // as its id, so it cannot point into another org.
    unique("contacts_org_and_id").on(table.orgId, table.id),
    // §8. The book lists an org's contacts by name, archived ones apart.
    index("contacts_org_name")
      .on(table.orgId, table.name)
      .where(sql`archived_at IS NULL`),
  ],
);

/**
 * Which trades a contact covers. `org_id` is redundant through `contacts` and
 * here anyway: ADR-0003's rule is that a query proves it is scoped without a
 * join, this one included, and it is what the policy reads.
 */
export const contactTags = pgTable(
  "contact_tags",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // The reference itself is `contact_tags_contact` below.
    contactId: uuid("contact_id").notNull(),
    // `restrict`, per §7's rule for reference data: deleting a trade that is
    // in use would silently untag everyone who has it.
    tag: text("tag")
      .notNull()
      .references(() => tradeTags.slug, { onDelete: "restrict" }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Led by `org_id`, as every index on a domain table is (§8). `contact_id`
    // is unique on its own, so this admits exactly the rows
    // `(contact_id, tag)` would, and it serves "the tags of these contacts".
    primaryKey({
      name: "contact_tags_pkey",
      columns: [table.orgId, table.contactId, table.tag],
    }),
    // The contact and its org, in one reference — `units_building`'s shape,
    // and §9's fifth checklist item. A tag goes with its contact.
    foreignKey({
      name: "contact_tags_contact",
      columns: [table.orgId, table.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete("cascade"),
    // §8. The trade filter: which of the org's contacts carry this tag.
    index("contact_tags_org_tag").on(table.orgId, table.tag),
  ],
);
