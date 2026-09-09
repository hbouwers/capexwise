import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { organizations } from "./organizations";
import { users } from "./users";

/**
 * The four tables Better Auth owns outright. `docs/data-model.md` §2 declines to
 * reproduce their columns and says why: they hold no domain data and their shape
 * is the library's to change, so writing them out twice would give us two things
 * to keep in step for no benefit.
 *
 * **These are not our design and the columns are not ours to tidy.** Every field
 * here exists because `getAuthTables()` in `better-auth@1.7.3` says the adapter
 * reads or writes it. The one liberty taken is `snake_case` column names and
 * `org` rather than `organization` in `sessions.active_org_id`; the provider is
 * told about that through the field mapping in `src/server/auth.ts`, and Better
 * Auth's own schema check (`advanced.database.validateSchema`, on by default)
 * fails at boot if the mapping ever stops matching. That check is what makes the
 * liberty safe to take.
 *
 * **No `org_id`, and no RLS org policy** — `users` says this at length and the
 * same reasoning covers all four. They are read during sign-in, before any org
 * context exists to scope them by, so a policy keyed on `app.current_org_id`
 * would evaluate against an unset GUC on every authentication request. What
 * stands in for scoping is that no application query touches them: Better Auth
 * reads them through the adapter and nothing else has a reason to.
 * `sessions.active_org_id` is the one column here that names an org, and it is a
 * *hint* — see the column.
 */

/**
 * A signed-in browser. Better Auth's `session`.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    // Cascade: signing out everywhere is what deleting a user should mean, and
    // a session belonging to nobody is not a fact worth keeping. §7's rule that
    // a `users` row survives whatever references it is about authorship, and a
    // session authors nothing.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The value in the cookie, and therefore a credential. Unique because it is
    // the lookup on every authenticated request — the index is not an
    // optimisation here, it is the query.
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Both nullable and both the provider's: it records what it saw, and what a
    // proxy chooses to send is not ours to guarantee. Neither is ever read for
    // an authorisation decision.
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    // Which org this browser is currently looking at. **A hint, not an
    // authority** (ADR-0004): the session says which org the user is asking
    // for, and the `memberships` join says whether they may have it. #26's
    // `getOrgContext()` does that join on every request rather than trusting
    // this column, which is why a stale or tampered value is inert.
    //
    // `set null` rather than `cascade`: deleting an org should drop its members
    // back to whichever org they are still in, not sign them out.
    activeOrgId: uuid("active_org_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // "Every session for this user" — what revoking access and the expiry sweep
    // both scan. The `token` lookup is already served by its unique constraint.
    index("sessions_user").on(table.userId),
  ],
);

/**
 * A credential at an identity provider, linked to a user. Better Auth's
 * `account`. In v0 there is exactly one shape of row here: Google.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The provider's own id for the person — Google's `sub`. Deliberately not
    // an email: a Google address can change and `sub` cannot, which is the
    // whole reason this is a column rather than a join on `users.email`.
    accountId: text("account_id").notNull(),
    // `"google"` today, and `"credential"` if passwords ever arrive.
    providerId: text("provider_id").notNull(),
    // Encrypted at rest rather than stored raw: `account.encryptOAuthTokens` is
    // on in `src/server/auth.ts`, so what lands in these three columns is
    // AES-256-GCM ciphertext keyed off `BETTER_AUTH_SECRET`. The repository goes
    // public at v0.5 and database dumps outlive the incidents that produce them;
    // a Google access token in a backup is a live credential at somebody else's
    // service, not merely a value of ours.
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    // Always null in v0 — ADR-0004 made Google OAuth the only sign-in method, so
    // there is no password to hash. The column exists because the adapter's
    // schema check expects the field, and dropping it would be a migration to
    // write back the day email sign-in arrives.
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One row per person per provider. Without it, a race between two concurrent
    // first sign-ins writes the same Google account twice and every later lookup
    // picks one of them arbitrarily.
    uniqueIndex("accounts_provider_account").on(
      table.providerId,
      table.accountId,
    ),
    // "Which providers is this user linked to" — the account-linking path, and a
    // real query the day a second provider arrives.
    index("accounts_user").on(table.userId),
  ],
);

/**
 * Short-lived tokens the provider issues and then consumes: OAuth state today,
 * and the email flows that do not exist yet. Better Auth's `verification`.
 *
 * Rows here are garbage by design — every one is consumed or expired within
 * minutes, and nothing but the provider ever reads one.
 */
export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The lookup, and the expiry sweep. Not unique: one identifier can hold more
    // than one live token, and the provider takes the newest.
    index("verifications_identifier").on(table.identifier, table.expiresAt),
  ],
);

/**
 * The rate-limit counters. Better Auth's `rateLimit`, and the one table in this
 * file that exists because of a deployment fact rather than because the library
 * always needs it.
 *
 * Better Auth counts in memory by default. On Vercel that is close to no limit
 * at all: each serverless instance keeps its own counter, instances are created
 * on demand, and the traffic that would create them is exactly the traffic worth
 * limiting. `storage: "database"` puts the counter somewhere every instance can
 * see. It costs a read and a write per auth request, which is the right trade on
 * a path that is meant to be rare.
 */
export const rateLimits = pgTable("rate_limits", {
  id: uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`),
  // The bucket — an IP address and a path, composed by the provider. Unique
  // because every operation on this table is a lookup by it.
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  // Epoch milliseconds rather than a timestamp, and Better Auth's choice rather
  // than ours: it does arithmetic on the value. `mode: "number"` because a
  // millisecond epoch sits far inside the safe integer range and the provider
  // hands us a `number`; `bigint` rather than `integer` because milliseconds
  // since 1970 passed 2^31 about three weeks in.
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

// No `created_at` / `updated_at` on `rate_limits`, and it is the one table in the
// schema without them. §1's rule is about rows somebody may later need to reason
// about; these are counters the provider overwrites in place and deletes when the
// window closes. The columns would also mean a trigger on the hottest write path
// in the auth flow, to maintain a timestamp duplicating `last_request`.
