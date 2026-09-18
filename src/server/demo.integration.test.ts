/**
 * The demo reset against a real database, as the restricted application login
 * (`capexwise_test_app`) — which is the claim ADR-0011 rests on. The reset
 * holds no bypass: it deletes and recreates one org on the identity path and
 * writes the content as `capexwise_scoped`. If either half needed more than
 * those two roles hold, these tests would fail with `permission denied` or a
 * policy violation rather than pass on a superuser's say-so.
 *
 * Three things are worth a database:
 *
 * - **The content fits the schema.** Every check constraint, composite key and
 *   deferred trigger the demo's rows pass through is a claim about Postgres,
 *   and a demo that fails to seed is a dead link in an interview.
 * - **A second run starts over rather than adding.** Same org id, same counts.
 * - **It touches the demo and the visitors and nothing else.** Another org's
 *   rows and a real account survive it.
 */
import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  buildingAccessCodes,
  buildings,
  capitalItems,
  contacts,
  memberships,
  organizations,
  rentPeriods,
  tasks,
  units,
  users,
} from "@/db/schema";
import { openAccessCode, parseKeyring } from "@/lib/access-code-cipher.mts";
import { applicationDatabaseUrl, testDb } from "@/test/db";
import {
  createBuilding,
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

// Dynamic, and after the assignments above, for the reason
// `org-context.integration.test.ts` gives.
const { findDemoOrgId, resetDemoOrg } = await import("@/server/demo");

/** A fixed night, so a failure names a date that can be run again. */
const NIGHT = new Date("2026-09-17T08:00:00Z");

async function rowsIn(
  table:
    | typeof buildings
    | typeof units
    | typeof contacts
    | typeof capitalItems
    | typeof tasks
    | typeof rentPeriods,
  orgId: string,
): Promise<number> {
  const [row] = await testDb()
    .select({ n: count() })
    .from(table)
    .where(eq(table.orgId, orgId));

  return row?.n ?? 0;
}

async function snapshot(orgId: string) {
  return {
    buildings: await rowsIn(buildings, orgId),
    units: await rowsIn(units, orgId),
    contacts: await rowsIn(contacts, orgId),
    capitalItems: await rowsIn(capitalItems, orgId),
    tasks: await rowsIn(tasks, orgId),
    rentPeriods: await rowsIn(rentPeriods, orgId),
  };
}

async function anonymousVisitor() {
  return await createUser({
    email: `temp-${crypto.randomUUID()}@anonymous.placeholder.invalid`,
    isAnonymous: true,
  });
}

describe("findDemoOrgId", () => {
  it("does not find a soft-deleted demo", async () => {
    await createOrganization({
      isDemo: true,
      slug: "demo",
      deletedAt: new Date(),
    });

    expect(await findDemoOrgId()).toBeNull();
  });
});

describe("resetDemoOrg", () => {
  it("seeds five buildings and eight doors where there was no demo", async () => {
    expect(await findDemoOrgId()).toBeNull();

    const summary = await resetDemoOrg(NIGHT);

    expect(await findDemoOrgId()).toBe(summary.orgId);
    expect(await snapshot(summary.orgId)).toMatchObject({
      buildings: 5,
      units: 8,
      contacts: 14,
    });

    const [org] = await testDb()
      .select()
      .from(organizations)
      .where(eq(organizations.id, summary.orgId));

    expect(org).toMatchObject({ isDemo: true, slug: "demo" });
  });

  it("starts over on a second run: the same org, the same rows", async () => {
    const first = await resetDemoOrg(NIGHT);
    const before = await snapshot(first.orgId);

    const second = await resetDemoOrg(NIGHT);

    expect(second.orgId).toBe(first.orgId);
    expect(await snapshot(second.orgId)).toEqual(before);
  });

  it("removes every visitor and leaves real accounts and other orgs alone", async () => {
    const { orgId } = await resetDemoOrg(NIGHT);
    const visitor = await anonymousVisitor();
    await createMembership(orgId, visitor.id);

    const customer = await createOrganization();
    const owner = await createUser();
    await createMembership(customer.id, owner.id, { role: "owner" });
    await createMembership(orgId, owner.id);
    await createBuilding(customer.id);

    const summary = await resetDemoOrg(NIGHT);

    expect(summary.visitorsRemoved).toBe(1);
    expect(
      await testDb().select().from(users).where(eq(users.id, visitor.id)),
    ).toEqual([]);

    // The real account keeps its own org and its building. Its membership in
    // the demo went with the demo — a reset is a new demo, not the old one.
    expect(await rowsIn(buildings, customer.id)).toBe(1);
    expect(
      await testDb()
        .select({ orgId: memberships.orgId })
        .from(memberships)
        .where(eq(memberships.userId, owner.id)),
    ).toEqual([{ orgId: customer.id }]);
  });

  it("seals access codes for the demo org, so the app can open them", async () => {
    const { orgId } = await resetDemoOrg(NIGHT);

    const [sealed] = await testDb()
      .select()
      .from(buildingAccessCodes)
      .where(eq(buildingAccessCodes.orgId, orgId))
      .limit(1);

    expect(sealed).toBeDefined();
    expect(
      openAccessCode(
        parseKeyring(process.env.ACCESS_CODE_KEYS!),
        orgId,
        sealed!,
      ),
    ).toMatch(/^\d+$/);
  });
});
