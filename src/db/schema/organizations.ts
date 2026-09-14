import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
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
 * `users`, `memberships` and `invitations` joined it in #24; `sessions`,
 * `accounts`, `verifications` and `rate_limits` came with the provider in #25.
 * This table came first because #17 needed a real migration to exercise the
 * pipeline with, and because everything else in the schema references it.
 *
 * Row-level security is on for this table, and it is declared in
 * `drizzle/0006_row_level_security.sql` rather than here: it comes with roles
 * and grants the schema does not describe, and the hand-written file is the one
 * place all of it reads together. The policy is keyed on `id` rather than
 * `org_id`, and who may create an org is answered by who holds the grant —
 * `docs/data-model.md` §9 has both.
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
    // Better Auth's, not ours, and the two columns in this table that no
    // CapExWise screen reads. The `organization` plugin declares both on its
    // `organization` model, so the adapter's schema check refuses to boot
    // without them (#25). Mapping them away is not an option — a field the
    // provider writes has to land somewhere.
    //
    // `logo` may become real if orgs ever get branding. `metadata` is the
    // plugin's arbitrary JSON-in-a-text-column escape hatch, and nothing we
    // write should go in it: a value the schema does not describe is a value the
    // migrations, the drift check and `docs/data-model.md` all miss.
    logo: text("logo"),
    metadata: text("metadata"),
    plan: orgPlan("plan").notNull().default("free"),
    isDemo: boolean("is_demo").notNull().default(false),
    // The capital reserve F3 projects forward (#92). One per org rather than
    // one per building, because a small landlord keeps one reserve account;
    // a building's page shows its ten-year *need* instead. Columns rather than
    // a table because nothing reads the history of the balance — the forecast
    // wants today's figure and the date it was true.
    //
    // All three null means no reserve has been entered, which is the forecast
    // rail's empty state; the `all_or_none` check below keeps a half-entered
    // reserve from being a fourth state for every reader to handle.
    //
    // `mode: "number"` because a JavaScript number holds integer cents exactly
    // up to 2^53, about $90 trillion, and a `bigint` can neither be mixed into
    // number arithmetic nor serialised to JSON — so it would be converted at
    // every boundary, and each conversion is a place to get it wrong.
    reserveBalanceCents: bigint("reserve_balance_cents", { mode: "number" }),
    // A `date`, not a timestamp: "as of 3 September" has no clock time and no
    // timezone (ADR-0005). What the balance was, not when it was typed. Read
    // back as a `YYYY-MM-DD` string, Drizzle's default: a JavaScript `Date`
    // would give it a midnight in some timezone, and move it a day in others.
    reserveAsOf: date("reserve_as_of"),
    reserveMonthlyContributionCents: bigint(
      "reserve_monthly_contribution_cents",
      { mode: "number" },
    ),
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
    // The reserve is entered as one thing, in one modal. A balance with no
    // date cannot be projected from, and a contribution with no balance has
    // nothing to add to. A contribution of zero is a real answer and passes.
    check(
      "organizations_reserve_all_or_none",
      sql`num_nulls(${table.reserveBalanceCents}, ${table.reserveAsOf}, ${table.reserveMonthlyContributionCents}) IN (0, 3)`,
    ),
    // Money set aside cannot be less than none, and a negative contribution
    // is a withdrawal, which is a replacement the forecast already counts.
    // The projection goes negative; what is stored does not.
    check(
      "organizations_reserve_not_negative",
      sql`${table.reserveBalanceCents} >= 0 AND ${table.reserveMonthlyContributionCents} >= 0`,
    ),
  ],
);
