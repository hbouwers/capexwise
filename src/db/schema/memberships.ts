import { sql } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { organizations } from "./organizations";
import { users } from "./users";

/**
 * The join that *is* the tenancy boundary: who may act inside which org, and as
 * what. `docs/data-model.md` §2. Better Auth's `member` under our name, for the
 * reason §2 gives — a table called `member` in the middle of the security model
 * reads as something borrowed rather than something we own, and this is the
 * table every RLS policy in #28 will join against.
 */

/**
 * Two values today, and the enum exists so a third is additive rather than a
 * schema change with a data migration behind it. The 10–50 unit management
 * group persona in the PRD wants a limited or read-only role; `ALTER TYPE ...
 * ADD VALUE` is the cheap direction for a native enum, and adding a value is
 * all that role would need here.
 *
 * The values are ordered least-to-most privileged rather than alphabetically,
 * because that is the order a permission check reads in.
 */
export const membershipRole = pgEnum("membership_role", ["member", "owner"]);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    // Cascade: deleting an org takes its memberships with it. §7's purge job
    // hard-deletes the org 30 days after `deleted_at` is set, and a membership
    // to an org that no longer exists is not a fact anyone wants kept.
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Cascade from the other side too: account deletion revokes memberships.
    // §7 is explicit that this does not erase authorship — nothing here is
    // authored, and the references that do survive a user (`inviter_id`, and
    // #42's audit log) are `restrict` instead.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One object, not two. `docs/data-model.md` lists a `unique (org_id,
    // user_id)` constraint in §2 and a `memberships_org_user` index on the same
    // two columns in §8; a unique constraint is already a btree index over
    // exactly those columns, so building both would give Postgres two identical
    // structures to maintain on every write. This is the constraint, under the
    // name §8 uses.
    uniqueIndex("memberships_org_user").on(table.orgId, table.userId),
    // The one index in the schema that does not lead with `org_id`, and the
    // reason ADR-0003's rule is about *domain* tables. "Which orgs am I in" is
    // the query behind the org switcher (#29) and it runs before an org context
    // exists to lead with — an index on `(org_id, user_id)` cannot serve it.
    index("memberships_user").on(table.userId),
  ],
);
