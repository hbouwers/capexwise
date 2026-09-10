/**
 * The tenancy boundary, as a function you call at the top of anything that
 * touches domain data. [ADR-0003](../../docs/adr/0003-multi-tenancy.md) is the
 * decision; this is the mechanism it promised, and `eslint.config.mjs` is what
 * makes it the only one.
 *
 * ```ts
 * const { org, role, db } = await getOrgContext();
 *
 * const rows = await db.run((tx) =>
 *   tx.select().from(buildings).where(eq(buildings.orgId, db.orgId)),
 * );
 * ```
 *
 * ## The two layers
 *
 * ADR-0003 defends the boundary twice, and the two are meant to fail
 * independently:
 *
 * 1. **The `where` clause you write.** Visible, reviewable, and the thing a
 *    developer reasons about. `db.orgId` is the value it filters on, and it came
 *    from a `memberships` join rather than from the request.
 * 2. **Row-level security** (#28). Inside every `db.run()` transaction the
 *    connection *becomes* `capexwise_scoped` and carries `app.current_org_id`,
 *    and the policies in `drizzle/0006_row_level_security.sql` hand that role
 *    one org's rows and nothing else. It catches the query where layer 1 was
 *    forgotten, which is the failure the ADR says is invisible in review because
 *    correct and incorrect code look identical.
 *
 * Write the `where` clause anyway. RLS turns a forgotten filter from a breach
 * into a query that quietly returns only this org's rows — which is the right
 * answer for a read and a surprising one for an `update` that meant to touch one
 * row and touched every row this org owns. Layer 2 is what makes the mistake
 * safe, not what makes it correct.
 *
 * ## Why the role switch, and not just the setting
 *
 * A policy only constrains a role it applies to, and the role the application
 * logs in as is not one of those: it is the compose superuser locally, and on
 * Neon it owns the tables — both of which Postgres lets past row-level security,
 * one always and the other unless `FORCE` names it. ADR-0003 answers that with
 * "the application runs as a separate restricted role", and this is where it
 * does: `SET LOCAL ROLE`, scoped to the same transaction as the setting, so a
 * scoped query is subject to the policies whatever `DATABASE_URL` logged in as,
 * and nothing about the switch survives the commit. ADR-0007 has the rest,
 * including why this is a role switch rather than a second connection string.
 *
 * ## The query that has to run before there is an org
 *
 * `resolveOrgForUser()` below *establishes* the context, so it necessarily runs
 * before there is a setting to filter by — the same chicken-and-egg
 * `docs/data-model.md` §2 describes for `users` and `sessions`, one table further
 * in. It therefore does not run through a scoped handle. It runs on the
 * identity path, as the login role, which the migration makes a member of
 * `capexwise_identity`; that role's policies admit every row of `memberships`,
 * `organizations` and `invitations` and no other org-owned table, which is the
 * whole of the bypass and the reason it is a narrow one. Better Auth reads the
 * same three tables the same way, for the same reason. §9 and ADR-0007 record
 * the two alternatives that lost.
 *
 * ## Why this file, and not a `where` clause everyone remembers
 *
 * The org id never comes from the caller. Not a route param, not a header, not a
 * request body — ADR-0003 is explicit that a client-supplied org id is *ignored,
 * not validated*, because validating one invites a code path where an id from
 * the wrong place is used on the grounds that it looked correct. The session
 * carries a hint; `resolveOrgForUser()` below is what decides whether the person
 * may have it, and it decides by joining `memberships` on every request.
 *
 * ## When a genuinely cross-org query is needed
 *
 * There is no helper here for that, deliberately. ADR-0003 says the escape hatch
 * "will be the most dangerous code in the product" and that it should arrive as
 * its own ADR rather than as a helper someone adds on a Tuesday, so the honest
 * state of things is:
 *
 * - **Migrations** (`src/db/migrate.mts`) open their own connection and run
 *   before any org exists. They are named in `eslint.config.mjs`.
 * - **The demo org's nightly reset** (#34) is SQL through the seed path, for the
 *   reason ADR-0003 gives: the demo org is a row, so resetting it is a statement
 *   rather than orchestration.
 * - **The integration harness** (`src/test/db.ts`) holds an unscoped connection
 *   because #27 has to tell a row that was correctly hidden from one that was
 *   never written. That is an assertion, not a bypass.
 * - **Support impersonation** does not exist, and ADR-0003 reserves it for its
 *   own ADR with its own role and an audit trail (#42).
 *
 * Anything else that wants past this file is a request to fix the ergonomics
 * here, which is the sentence CLAUDE.md and `src/db/client.ts` both end on.
 */
import "server-only";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { cache } from "react";

import { db as unscopedDb, type Db } from "@/db/client";
import { memberships, organizations } from "@/db/schema";
import { requireSession } from "@/server/session";

/**
 * The Postgres run-time setting the policies compare against, spelled once here
 * and once in SQL.
 *
 * The SQL spelling is inside `current_org_id()`, in
 * `drizzle/0006_row_level_security.sql`, which every policy calls. A mismatch
 * between the two would not error — `current_setting(..., true)` returns null
 * for a setting that was never set, and a policy comparing against null filters
 * *everything* out. The failure would be every page rendering zero rows, which
 * is a long way from the typo that caused it, so
 * `org-context.integration.test.ts` reads the setting back through that function
 * to tie the two together.
 */
export const ORG_ID_SETTING = "app.current_org_id";

/**
 * The role every scoped transaction runs as — created, granted and given its
 * policies by `drizzle/0006_row_level_security.sql`. Spelled here and in SQL,
 * and tied together the same way as `ORG_ID_SETTING`: a test asserts that
 * `current_user` inside `run()` is this.
 */
export const SCOPED_ROLE = "capexwise_scoped";

/** The transaction handle `db.run()` hands its callback. */
export type OrgScopedTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The org a request is acting in. Deliberately not the whole `organizations`
 * row: `logo` and `metadata` are Better Auth's and nothing here reads them, and
 * `deletedAt` is absent because a context is only ever built for an org that is
 * not deleted — carrying the column would invite a caller to check it again.
 */
export type OrgSummary = {
  id: string;
  name: string;
  slug: string;
  plan: (typeof organizations.$inferSelect)["plan"];
  isDemo: boolean;
};

export type OrgRole = (typeof memberships.$inferSelect)["role"];

/**
 * A database handle that knows which org it is for.
 *
 * Every call to `run()` is one transaction, and that is not incidental: the
 * role and the `app.current_org_id` setting both have to be applied with `SET
 * LOCAL` so that they end with the transaction rather than with the connection.
 * ADR-0003 is blunt about why — under transaction-mode pooling a session-level
 * setting outlives the request and is inherited by whichever request gets that
 * connection next, which is the exact breach this layer exists to prevent. A
 * transaction is what gives `SET LOCAL` a scope to be local to, and Neon's pooled
 * endpoint, which Vercel serves through, is pgbouncer in exactly that mode.
 *
 * The cost is a `BEGIN`/`COMMIT` around single-statement reads. That is accepted
 * rather than optimised around, because the alternative — a fast path without
 * the setting — is a second way to reach the database, and a second way is the
 * hole. #33 owns pooling and inherits the constraint.
 */
export type OrgScopedDb = {
  /** The org every query through this handle belongs to. Filter on it. */
  readonly orgId: string;

  /**
   * Runs `work` in one transaction, as `capexwise_scoped`, with
   * `app.current_org_id` set to `orgId`. Whatever `work` returns is what this
   * returns; a throw rolls the whole transaction back.
   */
  run<T>(work: (tx: OrgScopedTx) => Promise<T>): Promise<T>;
};

export type OrgContext = {
  user: { id: string; name: string; email: string };
  org: OrgSummary;
  role: OrgRole;
  db: OrgScopedDb;
};

/**
 * Raised when a signed-in person has no org to act in.
 *
 * Unreachable on the path that exists today: `resolveActiveOrganization()` in
 * `src/server/auth.ts` creates an org and an owner membership as the session is
 * created, so everybody who can sign in has one. It becomes reachable the moment
 * a member can be *removed* from their only org while their session is live,
 * which is #30's to introduce.
 *
 * A throw rather than a redirect, and the distinction is what the state means.
 * `requireSession()` redirects because "not signed in" is a normal thing to be;
 * this is a signed-in account with nowhere to be, which today can only mean
 * something upstream broke. Rendering a friendly page for it would be inventing
 * a supported state. The app shell (#29) arrived first and deliberately did not
 * take it: until something can remove a membership there is no way to reach the
 * page to check it, so #30, which introduces removal, is where this earns a
 * route.
 *
 * The message names the user id and nothing else. CLAUDE.md's rule is that logs
 * never carry PII, and an error message is a log the moment anything catches it.
 */
export class NoOrganizationError extends Error {
  constructor(userId: string) {
    super(
      `User ${userId} is signed in but is a member of no organization that ` +
        `still exists. Every account gets an org and an owner membership when ` +
        `its session is created (src/server/auth.ts), so this means either the ` +
        `membership was revoked or the org was soft-deleted.`,
    );

    this.name = "NoOrganizationError";
  }
}

/**
 * The join that decides. Given a user and whatever the session claims their
 * active org is, returns the org they may act in, or `null` if there is none.
 *
 * **The hint is an ordering preference, not a filter.** Every row this query can
 * return is an org the user holds a live membership in; the session's value only
 * decides *which* of them comes first. That is what "ignored, not validated"
 * looks like in SQL — a tampered, stale or absent `activeOrgId` cannot widen the
 * result set, only reorder it, so there is no branch where a bad value is
 * handled differently from a good one and therefore no branch to get wrong.
 *
 * The fallback when the hint does not match is the oldest membership, matching
 * `resolveActiveOrganization()` in `src/server/auth.ts`: for anyone in more than
 * one org that is their own rather than whichever they were most recently
 * invited to. It does not write the corrected value back to the session — a
 * write on every read path, to repair a state that costs one indexed lookup, is
 * the wrong trade, and #29's switcher sets the value properly when somebody
 * actually chooses.
 *
 * `deleted_at is null` is the other half of the check and is the easy one to
 * miss: `docs/data-model.md` §7 says access stops when an org is soft-deleted,
 * and the membership row survives that by design — the purge is 30 days later.
 * Without the join condition a deleted org stays fully usable for a month.
 *
 * Exported because it is the seam this file can be tested through.
 * `getOrgContext()` reads `headers()`, which needs a Next.js request; this needs
 * only a database, and the database is where the behaviour worth checking is.
 */
export async function resolveOrgForUser(
  userId: string,
  activeOrgId: string | null | undefined,
): Promise<{ org: OrgSummary; role: OrgRole } | null> {
  const [row] = await unscopedDb()
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      plan: organizations.plan,
      isDemo: organizations.isDemo,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, userId), isNull(organizations.deletedAt)))
    // One query rather than "try the hint, then fall back", which would be two
    // round trips on the path every authenticated request takes. The comparison
    // is a boolean, `true` sorts above `false` under `desc`, and when the hint
    // is null the expression is null for every row — so they all tie and
    // `created_at` decides.
    //
    // The cast is on the *column*, not on the parameter, and that is the line
    // that keeps the paragraph above true. Casting the parameter to `uuid` would
    // make a malformed hint raise `invalid input syntax for type uuid` and take
    // the request down — which is not a breach, but it is a value from outside
    // deciding whether the page renders, and this function's whole claim is that
    // it cannot. Comparing as text, a hint that is not an id is simply a hint
    // that matches nothing. Casting the column costs no index either way: this
    // is an `order by` over rows already selected by `user_id`, not a filter.
    .orderBy(
      desc(sql`${memberships.orgId}::text = ${activeOrgId ?? null}`),
      asc(memberships.createdAt),
    )
    .limit(1);

  if (!row) return null;

  const { role, ...org } = row;

  return { org, role };
}

/** One entry in the org switcher: enough to name it and to ask for it. */
export type OrgOption = { id: string; name: string };

/**
 * Every org the user may switch into — the query behind the org switcher, and
 * the reason `memberships_user` is the one index in the schema that does not
 * lead with `org_id`.
 *
 * The same identity-path read as `resolveOrgForUser()` above, for the same
 * reason: "which orgs am I in" has to be answered before one of them is the
 * context, so there is no org to scope it by. It is also the same join and the
 * same `deleted_at is null` — the list and the resolution must agree about which
 * orgs exist, or the switcher offers an org that `getOrgContext()` then refuses
 * to open and the choice silently does nothing.
 *
 * Oldest membership first, which is the order the resolution falls back in: the
 * account's own org leads, and the list is stable for as long as the
 * memberships are.
 *
 * It takes a user id, like `resolveOrgForUser()` and for the same reason — it is
 * the seam the database can be tested through. The id it is handed is the one
 * `getOrgContext()` resolved from the session; there is no other caller.
 */
export async function listOrgsForUser(userId: string): Promise<OrgOption[]> {
  return await unscopedDb()
    .select({ id: organizations.id, name: organizations.name })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, userId), isNull(organizations.deletedAt)))
    // `id` breaks a tie between two memberships created in the same instant,
    // which is what a seed or a transaction produces. Without it the order of
    // the two is whatever the plan returns, and a menu that reorders itself
    // between renders is the kind of bug nobody can reproduce on request.
    .orderBy(asc(memberships.createdAt), asc(memberships.id));
}

/**
 * A handle scoped to one org.
 *
 * **Do not call this from a page, a component or a server action.** It takes an
 * org id as an argument and checks nothing about it, which is the point: the
 * check is `getOrgContext()`'s, and it happens in `resolveOrgForUser()` above.
 * Calling this with an id that came from a request is precisely the bug ADR-0003
 * exists to prevent, and it would look entirely reasonable in review.
 *
 * It is exported for two callers and no others: `getOrgContext()`, and the
 * integration test that has to build a handle without a session to build one
 * from. If a third appears, the question to ask is what `getOrgContext()` is
 * missing.
 */
export function forOrg(orgId: string): OrgScopedDb {
  return {
    orgId,

    async run<T>(work: (tx: OrgScopedTx) => Promise<T>): Promise<T> {
      return await unscopedDb().transaction(async (tx) => {
        // `set_config(name, value, true)` is `SET LOCAL` in a form that takes
        // the value as a parameter — `SET LOCAL` itself does not, and building
        // the statement by interpolation would put an id into SQL text on every
        // request. `role` is a setting like any other as far as `set_config` is
        // concerned, and switching it is `SET LOCAL ROLE` with the same
        // permission check. One statement for both, so the switch costs no
        // round trip of its own.
        //
        // The `true` is the entire safety property of this line, twice over:
        // pass `false` and the role and the org both become session-level,
        // survive the commit and are inherited by the next request handed this
        // pooled connection. `org-context.integration.test.ts` is what holds
        // those arguments in place, because nothing else would notice them
        // change.
        const applied = await tx.execute<{
          role: string | null;
          org_id: string | null;
        }>(
          sql`select set_config('role', ${SCOPED_ROLE}, true) as role,
                     set_config(${ORG_ID_SETTING}, ${orgId}, true) as org_id`,
        );

        // ADR-0003 asks this helper to assert the context took, and
        // `docs/data-model.md` §9 gives the reason: a policy comparing against
        // an unset setting filters everything out rather than raising, so the
        // symptom of a context that never applied is a page rendering zero
        // buildings. That is a terrible way to learn about it. `set_config`
        // returns what it set, so the check costs the comparison and nothing
        // else. A login role that may not become the scoped one never gets
        // this far — the switch raises `permission denied to set role`.
        const [row] = applied.rows;

        if (row?.role !== SCOPED_ROLE || row.org_id !== orgId) {
          throw new Error(
            `Failed to apply ${SCOPED_ROLE} and ${ORG_ID_SETTING} for the ` +
              `transaction. Every row-level security policy is written for that ` +
              `role and compares against that setting, and a context that did ` +
              `not apply filters silently rather than raising — so this stops ` +
              `here instead of returning an empty result that looks like data.`,
          );
        }

        return await work(tx);
      });
    },
  };
}

/**
 * Who is signed in, which org they are acting in, and a handle scoped to it.
 * The first line of anything that reads or writes domain data.
 *
 * Redirects a stranger to sign in, by way of `requireSession()` — so there is no
 * null branch and therefore no way to forget one. Throws `NoOrganizationError`
 * for the signed-in account with no org, which is a different situation and gets
 * different treatment; the class says why.
 *
 * **Memoised for the length of one request** with React's `cache()`. A page is
 * many Server Components deep and every one of them is entitled to ask, so
 * without this a screen with a header, a sidebar and three tiles would run the
 * membership join five times to reach the same answer — and the ergonomics
 * argument for hoisting the call to the top and drilling it down is exactly the
 * pressure that gets the whole helper routed around. The cache is per-request by
 * construction: React scopes it to the render pass, so there is no cross-request
 * key to get wrong and nothing to invalidate.
 *
 * The one consequence worth knowing: a server action that switches the active
 * org and then calls this again in the same invocation gets the org it started
 * with. #29's switcher redirects after switching, which starts a new request and
 * a new cache, so that is the shape to keep.
 */
export const getOrgContext = cache(async (): Promise<OrgContext> => {
  const { user, session } = await requireSession();

  // `activeOrganizationId`, not `activeOrgId`. `src/server/auth.ts` maps the
  // *column* to `active_org_id` to keep the house spelling in the schema, but
  // the plugin's own field name is what survives into the session object it
  // hands back — so the two spellings are both correct, in different places.
  const resolved = await resolveOrgForUser(
    user.id,
    session.activeOrganizationId,
  );

  if (!resolved) throw new NoOrganizationError(user.id);

  return {
    // `?? ""` because the type is Better Auth's and the column is ours:
    // `users.name` is nullable on purpose, and only the provider's OAuth path
    // coerces a missing name to "". A row written any other way — a seed, a
    // psql session — reaches here as null under a `string` type, and the
    // shell's account menu called `.trim()` on it.
    user: { id: user.id, name: user.name ?? "", email: user.email },
    org: resolved.org,
    role: resolved.role,
    db: forOrg(resolved.org.id),
  };
});
