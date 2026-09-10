import { sql } from "drizzle-orm";
import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Identity, and the first of the four tables that sit *above* the tenancy
 * boundary. `docs/data-model.md` §2 is the prose version of this file.
 *
 * This is Better Auth's `user` table under our name and with our id type — the
 * reconciliation ADR-0004 deferred and §2 settled. `sessions`, `accounts` and
 * `verifications` are the other three and arrive with the provider in #25;
 * they hold no domain data and their columns are the library's to change, which
 * is why they wait for the version that will be pinned rather than being
 * guessed at now.
 *
 * **No `org_id`, deliberately.** A person belongs to more than one org with one
 * account — their own, the demo, a customer they are helping — so identity
 * cannot live inside a tenant. These rows are also read during sign-in, before
 * any org context exists to scope them by. The consequence is stated in §2 and
 * worth restating where the table is: `users` is outside the ADR-0003
 * protection scheme. It is not reachable through `db.forOrg()` (#26) — the
 * scoped role holds no grant on it (#28) — and the cross-org isolation test
 * (#27) does not apply to it. What stands in for that is that no application query reads it except
 * through `memberships`, which is org-scoped.
 */
export const users = pgTable("users", {
  id: uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`),
  // Unique on the value as stored, per §2. Case folding is not done here: in v0
  // the only way to get a row is Google OAuth, which supplies an already
  // normalised address, and a `lower(email)` index would be a promise about
  // every future provider that this table cannot keep on its own. Normalisation
  // belongs with whatever creates the row — revisit with the second provider,
  // not before.
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  // Nullable: what an OAuth provider returns about a person is its choice, not
  // ours, and neither of these is load-bearing for anything in the product.
  name: text("name"),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Trigger-maintained, like every other `updated_at` — see `drizzle/0001`.
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
