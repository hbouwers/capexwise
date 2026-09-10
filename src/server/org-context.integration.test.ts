/**
 * The tenancy helper against a real database. Everything asserted here is a
 * claim `npm run typecheck` cannot check and a unit test cannot reach, because
 * every one of them is about what Postgres does.
 *
 * Three things are worth a database:
 *
 * **The membership join decides, and the session's hint only reorders.**
 * `resolveOrgForUser()` is the single place where "which org is this person
 * acting in" is answered, and ADR-0003 stakes the whole design on the answer
 * coming from `memberships` rather than from the request. The tests below hand
 * it hints for orgs the user is not in, hints for soft-deleted orgs, and hints
 * that are not ids at all, and none of them may change which rows it can see.
 *
 * **`SET LOCAL` is local.** `forOrg().run()` passes `true` as `set_config`'s
 * third argument, for the org and for the role. Pass `false` and every test that
 * checks them *inside* the transaction still passes, while both silently outlive
 * the commit and are inherited by whatever request is handed that pooled
 * connection next — which ADR-0003 names as the exact breach the layer exists to
 * prevent. That argument is the reason this file exists, and #28 made it matter
 * twice: a leaked role is a connection that stays `capexwise_scoped` after its
 * request, and a leaked org is one that stays in somebody else's org.
 *
 * **`run()` is one transaction.** The point above depends on it entirely: `SET
 * LOCAL` outside a transaction block is a no-op with a warning.
 *
 * `getOrgContext()` itself is not here. It reads `headers()`, which needs a
 * Next.js request, and forging one would test the forgery — so the file is
 * written around the seam that does not: `resolveOrgForUser()` and `forOrg()`
 * are what it composes, and they need only a database.
 *
 * The module is pointed at the test database by setting `DATABASE_URL` before it
 * is imported, which works only because `@/server/env` and `@/db/client` both
 * read on first use rather than on import. `src/server/auth.integration.test.ts`
 * does the same thing for the same reason.
 */
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { memberships } from "@/db/schema";
import { appDb, applicationDatabaseUrl, testDb } from "@/test/db";
import {
  createMembership,
  createOrganization,
  createUser,
} from "@/test/factories";

process.env.DATABASE_URL = applicationDatabaseUrl;
process.env.APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "integration-suite-secret-not-a-real-one";
process.env.GOOGLE_CLIENT_ID = "integration-suite-client-id";
process.env.GOOGLE_CLIENT_SECRET = "integration-suite-client-secret";
// Base64url of "integration-suite-not-a-real-key": a shape, not a secret.
process.env.ACCESS_CODE_KEYS = "1:aW50ZWdyYXRpb24tc3VpdGUtbm90LWEtcmVhbC1rZXk";

// Dynamic, and after the assignments above: a static import is hoisted, and the
// pool would be built from `.env.local` before the first line of this file ran.
const { ORG_ID_SETTING, SCOPED_ROLE, forOrg, resolveOrgForUser } =
  await import("@/server/org-context");

/**
 * Timestamps the tests set explicitly rather than letting `defaultNow()` supply.
 * The oldest-membership tie-break is the thing under test in two of them, and
 * two inserts a millisecond apart is a race to lose on a slow morning.
 */
const EARLIER = new Date("2026-01-01T00:00:00.000Z");
const LATER = new Date("2026-06-01T00:00:00.000Z");

/**
 * What the setting reads as, from inside a scoped transaction and from outside
 * every transaction, on the connection the application actually uses.
 *
 * `current_setting(name, true)` rather than plain `current_setting`: the second
 * argument is `missing_ok`, and without it an unset setting raises instead of
 * returning null. That is the same call `docs/data-model.md` §9's policy
 * template makes, so reading it the way a policy would is the point.
 */
const CURRENT_ORG = sql`current_setting(${ORG_ID_SETTING}, true) as org_id`;

describe("resolveOrgForUser", () => {
  it("returns the org the session points at, with the caller's role", async () => {
    const user = await createUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id, { role: "owner" });

    const resolved = await resolveOrgForUser(user.id, org.id);

    expect(resolved?.org.id).toBe(org.id);
    expect(resolved?.org.slug).toBe(org.slug);
    expect(resolved?.role).toBe("owner");
  });

  it("ignores a hint for an org the user is not a member of", async () => {
    const user = await createUser();
    const own = await createOrganization();
    const somebodyElses = await createOrganization();
    await createMembership(own.id, user.id);

    // The case the whole design is about: a session naming an org this account
    // has no membership in. It resolves to their own org rather than erroring,
    // and — the part that matters — it never resolves to the other one.
    const resolved = await resolveOrgForUser(user.id, somebodyElses.id);

    expect(resolved?.org.id).toBe(own.id);
  });

  it("ignores a hint that is not an id at all", async () => {
    const user = await createUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);

    // A value that cannot be a `uuid`. Unreachable through a signed session
    // cookie, and asserted anyway: the comparison is deliberately made as text
    // so that a malformed hint matches nothing instead of raising, and casting
    // the parameter instead of the column would turn this into a 500.
    const resolved = await resolveOrgForUser(user.id, "not-a-uuid");

    expect(resolved?.org.id).toBe(org.id);
  });

  it("ignores a hint for a soft-deleted org", async () => {
    const user = await createUser();
    const live = await createOrganization();
    const deleted = await createOrganization({ deletedAt: new Date() });
    await createMembership(live.id, user.id, { createdAt: LATER });
    await createMembership(deleted.id, user.id, { createdAt: EARLIER });

    // The membership outlives the soft delete by design — the purge is 30 days
    // later (`docs/data-model.md` §7) — so without `deleted_at is null` in the
    // join this would resolve to the deleted org twice over: it is both the
    // hinted one and the older one.
    const resolved = await resolveOrgForUser(user.id, deleted.id);

    expect(resolved?.org.id).toBe(live.id);
  });

  it("returns null when the user's only org is soft-deleted", async () => {
    const user = await createUser();
    const org = await createOrganization({ deletedAt: new Date() });
    await createMembership(org.id, user.id);

    expect(await resolveOrgForUser(user.id, org.id)).toBeNull();
  });

  it("falls back to the oldest membership when the session names no org", async () => {
    const user = await createUser();
    const first = await createOrganization();
    const second = await createOrganization();
    await createMembership(first.id, user.id, { createdAt: EARLIER });
    await createMembership(second.id, user.id, { createdAt: LATER });

    // Oldest rather than newest, matching `resolveActiveOrganization()` in
    // `src/server/auth.ts`: for anyone in more than one org that is their own,
    // not whichever they were most recently invited to.
    expect((await resolveOrgForUser(user.id, null))?.org.id).toBe(first.id);
    expect((await resolveOrgForUser(user.id, undefined))?.org.id).toBe(
      first.id,
    );
  });

  it("returns null for a user who is a member of nothing", async () => {
    const user = await createUser();
    await createOrganization();

    expect(await resolveOrgForUser(user.id, null)).toBeNull();
  });

  it("does not see another user's memberships", async () => {
    const user = await createUser();
    const other = await createUser();
    const otherOrg = await createOrganization();
    await createMembership(otherOrg.id, other.id);

    expect(await resolveOrgForUser(user.id, otherOrg.id)).toBeNull();
  });
});

describe("forOrg().run", () => {
  it("runs as the scoped role, with the org the policies read", async () => {
    const org = await createOrganization();

    // `current_org_id()` alongside the raw setting, because it is what every
    // policy actually calls, and it spells the setting's name a second time in
    // SQL. If the two spellings ever drift, this is the assertion that notices:
    // the setting is applied and the policies read null.
    const inside = await forOrg(org.id).run(async (tx) => {
      const { rows } = await tx.execute<{
        role: string;
        org_id: string | null;
        policy_org_id: string | null;
      }>(
        sql`select current_user as role, ${CURRENT_ORG},
                   current_org_id()::text as policy_org_id`,
      );

      return rows[0];
    });

    expect(inside).toEqual({
      role: SCOPED_ROLE,
      org_id: org.id,
      policy_org_id: org.id,
    });
  });

  it("does not leak the role or the setting to the next user of the pooled connection", async () => {
    const org = await createOrganization();

    const inside = await forOrg(org.id).run(async (tx) => {
      const { rows } = await tx.execute<{
        role: string;
        org_id: string | null;
        pid: number;
      }>(
        sql`select current_user as role, ${CURRENT_ORG}, pg_backend_pid() as pid`,
      );

      return rows[0];
    });

    expect(inside?.role).toBe(SCOPED_ROLE);
    expect(inside?.org_id).toBe(org.id);

    // The next statement on the pool, standing in for the next request. The pid
    // is asserted alongside the setting for a reason: `pg.Pool` hands back the
    // connection it just released, but if it ever handed back a fresh one this
    // test would report "unset" no matter what `set_config`'s third argument
    // was, and pass while proving nothing. Same backend, no setting, or the
    // assertion is not doing its job.
    const { rows } = await appDb().execute<{
      role: string;
      login: string;
      org_id: string | null;
      pid: number;
    }>(
      sql`select current_user as role, session_user as login, ${CURRENT_ORG},
                 pg_backend_pid() as pid`,
    );

    expect(rows[0]?.pid).toBe(inside?.pid);
    // Back to whatever the pool logged in as. A connection still acting as the
    // scoped role would hand the next request the policies of an org it never
    // resolved — and, worse, the identity path would lose the policies it needs
    // to resolve one.
    expect(rows[0]?.role).toBe(rows[0]?.login);
    // Postgres reports a setting cleared by the end of its transaction as the
    // empty string rather than null — it was set once in this session, so it
    // exists with no value. Either answer means the org context is gone; what
    // must never come back is the id.
    expect(rows[0]?.org_id ?? "").toBe("");
  });

  it("leaves the scoped role seeing nothing, rather than raising, on a connection an org has used", async () => {
    const org = await createOrganization();
    const user = await createUser();
    await createMembership(org.id, user.id);

    const pid = await forOrg(org.id).run(async (tx) => {
      const { rows } = await tx.execute<{ pid: number }>(
        sql`select pg_backend_pid() as pid`,
      );

      return rows[0]?.pid;
    });

    // The same connection, as the scoped role and with no org applied — what a
    // future helper that switched the role and forgot the setting would do. The
    // setting now reads back as '' rather than null, and `''::uuid` raises, so
    // without the `nullif` in `current_org_id()` this is a type error here and
    // an empty result on a fresh connection. It must be the empty result on
    // both: fail closed, one way, whichever connection the pool hands out.
    const after = await appDb().transaction(async (tx) => {
      await tx.execute(sql`select set_config('role', ${SCOPED_ROLE}, true)`);

      const { rows } = await tx.execute<{ visible: number; pid: number }>(
        sql`select (select count(*)::int from memberships) as visible,
                   pg_backend_pid() as pid`,
      );

      return rows[0];
    });

    expect(after?.pid).toBe(pid);
    expect(after?.visible).toBe(0);
  });

  it("runs its callback in one transaction, and rolls back on a throw", async () => {
    const org = await createOrganization();
    const user = await createUser();

    await expect(
      forOrg(org.id).run(async (tx) => {
        await tx.execute(
          sql`insert into memberships (org_id, user_id) values (${org.id}, ${user.id})`,
        );

        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");

    // Read back through the harness's own connection rather than the pool: the
    // question is whether the row was committed, and a second connection is the
    // only thing that can answer it.
    const rows = await testDb()
      .select()
      .from(memberships)
      .where(eq(memberships.orgId, org.id));

    expect(rows).toHaveLength(0);
  });
});
