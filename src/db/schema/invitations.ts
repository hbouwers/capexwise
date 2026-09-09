import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { membershipRole } from "./memberships";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * A pending membership. `docs/data-model.md` §2, and Better Auth's `invitation`
 * under our name.
 *
 * The table is here rather than with the invites feature (#30) because it is
 * part of the tenancy spine — Better Auth's `organization` plugin expects it to
 * exist for the plugin to load at all, and #25 wires that provider. #30 owns
 * the flow: sending, accepting, expiring, and the screens for all three. This
 * file owns only the shape.
 */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // The invitee has no `users` row yet — that is what an invitation is. An
    // email address, and no other tenant PII: §1's custody line applies here as
    // much as anywhere.
    email: text("email").notNull(),
    // The same enum `memberships` uses, so an invitation cannot offer a role
    // that a membership could not hold.
    role: membershipRole("role").notNull().default("member"),
    // `text` with a check rather than a native enum, and the one place in the
    // schema that departs from §1's test. These four values are Better Auth's,
    // not ours: the library writes them, an upgrade may add a fifth, and a check
    // constraint is a one-line migration to widen where a native enum in a
    // library-written column is a coordination problem. `docs/data-model.md` §2
    // specifies it this way for that reason.
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // `restrict`, not `cascade`: §7's rule is that a `users` row survives as
    // long as anything references it. Losing the invitation would be the small
    // harm; losing *who sent it* while the invitation stands is the real one.
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The invites screen's query: this org's invitations, by state, oldest
    // expiry first. Also what an expiry sweep scans.
    index("invitations_org_status").on(
      table.orgId,
      table.status,
      table.expiresAt,
    ),
    // Named for what a violation means rather than for the columns, so the
    // constraint name in the error says which rule was broken.
    check(
      "invitations_status_known",
      sql`${table.status} IN ('pending', 'accepted', 'canceled', 'expired')`,
    ),
  ],
);
