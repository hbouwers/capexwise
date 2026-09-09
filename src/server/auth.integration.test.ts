/**
 * The auth provider against a real database. This is the test that makes the
 * Better Auth reconciliation in `docs/data-model.md` §2 something checked rather
 * than something asserted.
 *
 * Two claims are worth a database to check, and neither can be checked without
 * one:
 *
 * **The name and field mapping is right.** `src/server/auth.ts` tells the
 * provider that its `member` is our `memberships`, that `organizationId` is our
 * `orgId`, and so on down. Every one of those is a string, none of them is
 * type-checked against anything, and the cost of getting one wrong is a failure
 * on somebody's first sign-in. Better Auth's own schema check runs when the
 * adapter is first used, so exercising the adapter is what runs it.
 *
 * **A new account comes out of sign-up with an org and an owner membership, in
 * one transaction.** That is #25's checklist item, and it is the one piece of
 * behaviour in this file that is ours rather than the library's.
 *
 * The provider is pointed at the test database by setting `DATABASE_URL` before
 * the module is imported — which works only because `@/server/env` and
 * `@/db/client` both read on first use rather than on import. That property was
 * added for `next build`; this is the second thing it buys.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { memberships, organizations, sessions, users } from "@/db/schema";
import { testDatabaseUrl, testDb } from "@/test/db";
import { createMembership, createOrganization } from "@/test/factories";

process.env.DATABASE_URL = testDatabaseUrl;
process.env.APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "integration-suite-secret-not-a-real-one";
process.env.GOOGLE_CLIENT_ID = "integration-suite-client-id";
process.env.GOOGLE_CLIENT_SECRET = "integration-suite-client-secret";

// Dynamic, and after the assignments above: a static import is hoisted, and the
// provider would build its handle from `.env.local` before the first line of
// this file ran.
const { getAuth } = await import("@/server/auth");

/**
 * Better Auth's own internal adapter — the layer every endpoint writes through,
 * and therefore the layer that applies the name mapping, the id strategy and the
 * `databaseHooks` below. Going through it rather than through an HTTP endpoint
 * is deliberate: the endpoints for sign-in redirect to Google, and nothing in
 * this suite can complete that round trip.
 */
async function internalAdapter() {
  const { internalAdapter } = await getAuth().$context;

  return internalAdapter;
}

let sequence = 0;

async function signUp() {
  sequence += 1;

  const adapter = await internalAdapter();

  return await adapter.createUser(
    {
      email: `signup-${sequence}@example.test`,
      name: `Casey Signup ${sequence}`,
      emailVerified: true,
    },
    { method: "oauth", oauth: { providerId: "google" } },
  );
}

beforeEach(() => {
  sequence = 0;
});

describe("the schema mapping", () => {
  it("writes a user through the adapter into `users`", async () => {
    // If `user.modelName` were wrong, or a field name did not resolve to a
    // Drizzle property, this is where it fails — and it fails naming the model
    // or the field rather than as a 500 on a real sign-in.
    const created = await signUp();

    const [row] = await testDb()
      .select()
      .from(users)
      .where(eq(users.id, created.id));

    expect(row?.email).toBe(created.email);
    // The database generated the id, not the library: `generateId: false` plus
    // the `uuidv7()` column default (ADR-0005). A Better Auth id would be a
    // random string and would not parse as a UUID at all.
    expect(row?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("writes a session, including the renamed active-org column", async () => {
    const user = await signUp();
    const adapter = await internalAdapter();

    const session = await adapter.createSession(user.id, false);

    const [row] = await testDb()
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id));

    expect(row?.userId).toBe(user.id);
    expect(row?.token).toBe(session.token);
    // `activeOrganizationId` in the provider, `active_org_id` in the database.
    // This assertion is the field mapping in `src/server/auth.ts`, checked.
    expect(row?.activeOrgId).not.toBeNull();
  });
});

describe("the first session of a new account", () => {
  it("creates an organization and an owner membership", async () => {
    const user = await signUp();
    const adapter = await internalAdapter();

    await adapter.createSession(user.id, false);

    const [membership] = await testDb()
      .select()
      .from(memberships)
      .where(eq(memberships.userId, user.id));

    expect(membership?.role).toBe("owner");

    const [org] = await testDb()
      .select()
      .from(organizations)
      .where(eq(organizations.id, membership!.orgId));

    // The placeholder name #39 replaces. Asserted because it is what a new user
    // actually sees, and because a name of `undefined's portfolio` would
    // otherwise ship unnoticed.
    expect(org?.name).toBe("Casey's portfolio");
    expect(org?.slug).toMatch(/^casey-s-portfolio-[0-9a-f]{6}$/);
    expect(org?.plan).toBe("free");
    expect(org?.isDemo).toBe(false);
  });

  it("points the session at that organization", async () => {
    const user = await signUp();
    const adapter = await internalAdapter();

    const session = await adapter.createSession(user.id, false);

    const [membership] = await testDb()
      .select()
      .from(memberships)
      .where(eq(memberships.userId, user.id));

    const [row] = await testDb()
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id));

    expect(row?.activeOrgId).toBe(membership?.orgId);
  });

  it("creates exactly one organization however many times they sign in", async () => {
    // The whole reason this hangs off session creation rather than user
    // creation: it has to be idempotent, because it runs on every sign-in.
    const user = await signUp();
    const adapter = await internalAdapter();

    await adapter.createSession(user.id, false);
    await adapter.createSession(user.id, false);
    await adapter.createSession(user.id, false);

    const rows = await testDb()
      .select()
      .from(memberships)
      .where(eq(memberships.userId, user.id));

    expect(rows).toHaveLength(1);
    expect(await testDb().select().from(organizations)).toHaveLength(1);
  });

  it("gives two accounts an organization each", async () => {
    // Two people called Casey collide on the slug stem, which is what the random
    // suffix is for — without it the second sign-up fails on a unique constraint
    // and the person has no way to fix it.
    const adapter = await internalAdapter();

    const first = await signUp();
    const second = await signUp();

    await adapter.createSession(first.id, false);
    await adapter.createSession(second.id, false);

    const orgs = await testDb().select().from(organizations);

    expect(orgs).toHaveLength(2);
    expect(new Set(orgs.map((org) => org.slug)).size).toBe(2);
  });
});

describe("an account that already belongs somewhere", () => {
  it("opens in the existing organization rather than making a new one", async () => {
    // The invited-member path (#30), and the one case where creating an org
    // would be actively wrong: it would put somebody who was invited into a
    // colleague's portfolio in an empty portfolio of their own instead.
    const user = await signUp();
    const org = await createOrganization({ name: "Somebody else's portfolio" });
    await createMembership(org.id, user.id, { role: "member" });

    const adapter = await internalAdapter();
    const session = await adapter.createSession(user.id, false);

    const [row] = await testDb()
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id));

    expect(row?.activeOrgId).toBe(org.id);
    expect(await testDb().select().from(organizations)).toHaveLength(1);

    // Still a member, not silently promoted.
    const [membership] = await testDb()
      .select()
      .from(memberships)
      .where(
        and(eq(memberships.userId, user.id), eq(memberships.orgId, org.id)),
      );

    expect(membership?.role).toBe("member");
  });
});
