import { sql } from "drizzle-orm";
import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The tenancy root. `docs/data-model.md` §2 is the prose version of this file
 * and the two are expected to match — a divergence is a bug in whichever was
 * changed without the other.
 *
 * Only this table is here. `users`, `memberships` and `invitations` are #24,
 * and the four Better Auth tables come with the provider in #25. This one
 * exists now because #17 needs a real migration to exercise the pipeline with,
 * and because everything else in the schema will reference it.
 *
 * Row-level security is deliberately not enabled here yet. #28 owns it, and
 * `organizations` is the one table the standard policy template does not fit —
 * `docs/data-model.md` §9 says why, and it is a question about who may create an
 * org rather than a detail of the policy.
 */

/**
 * Three values, not two. Pricing separates *pays us* from *has the premium
 * features* (PRD §12), so `paid` sits between `free` and `premium`.
 *
 * A native enum because the set is defined rather than merely current. Cheap
 * to add a value to, expensive to rename or remove one — which is the test
 * `docs/data-model.md` §1 applies.
 */
export const orgPlan = pgEnum("org_plan", ["free", "paid", "premium"]);

export const organizations = pgTable(
  "organizations",
  {
    // `uuidv7()` rather than `defaultRandom()`, which would emit
    // `gen_random_uuid()` — a v4, and v4 is what ADR-0005 rejected. The
    // default lives in the database so a row inserted by a migration, the
    // demo seed (#34) or a psql session is as well-formed as one from the app.
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    plan: orgPlan("plan").notNull().default("free"),
    isDemo: boolean("is_demo").notNull().default(false),
    // Soft delete, one of only two in the schema. Access stops when this is
    // set; a purge job hard-deletes 30 days later (§7).
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Maintained by a trigger rather than by the application, so a manual
    // UPDATE cannot leave it stale. Drizzle does not model triggers, so the
    // `defaultNow()` here is only the insert value — see `drizzle/0001_updated_at.sql`.
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // At most one demo org, enforced rather than assumed (#34). A partial
    // unique index over a boolean: the predicate is written as raw SQL because
    // Drizzle renders a column reference table-qualified, which is not valid
    // inside CREATE INDEX ... WHERE.
    uniqueIndex("organizations_one_demo")
      .on(table.isDemo)
      .where(sql`is_demo`),
  ],
);
