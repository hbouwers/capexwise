/**
 * The forecast page's read and its one write, inside one org: the reserve
 * written whole to the session's org and to no other, and the read leaving out
 * what the portfolio's figures leave out. The cross-org half of the read is the
 * isolation test's.
 *
 * Driven as the page drives them — a signed session, then the function — as
 * `capital-items.integration.test.ts` does, whose session setup this repeats.
 */
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { organizations } from "@/db/schema";
import { todayIn } from "@/lib/dates";
import { applicationDatabaseUrl, testDb } from "@/test/db";
import {
  createBuilding,
  createCapitalItem,
  createMembership,
  createOrganization,
  createUnit,
  createUser,
} from "@/test/factories";

const request = vi.hoisted(() => ({ headers: new Headers() }));

vi.mock("next/headers", () => ({
  headers: async () => request.headers,
}));

process.env.DATABASE_URL = applicationDatabaseUrl;
process.env.APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "integration-suite-secret-not-a-real-one";
process.env.GOOGLE_CLIENT_ID = "integration-suite-client-id";
process.env.GOOGLE_CLIENT_SECRET = "integration-suite-client-secret";

// Dynamic, and after the assignments above, for the reason the isolation test
// gives.
const { getAuth } = await import("@/server/auth");
const { updateReserve } = await import("@/server/actions/reserve");
const { getForecastInputs } = await import("@/server/queries/forecast");

const ZONE = "America/Indiana/Indianapolis";

/** An org with its owner signed in as the requests below. */
async function signedIn() {
  const org = await createOrganization();
  const owner = await createUser();
  await createMembership(org.id, owner.id, { role: "owner" });

  const context = await getAuth().$context;
  const session = await context.internalAdapter.createSession(owner.id, false);
  const signature = await makeSignature(session.token, context.secret);

  request.headers = new Headers({
    cookie: `${context.authCookies.sessionToken.name}=${session.token}.${signature}`,
  });

  return org;
}

async function reserveOf(orgId: string) {
  const [row] = await testDb()
    .select({
      balance: organizations.reserveBalanceCents,
      asOf: organizations.reserveAsOf,
      contribution: organizations.reserveMonthlyContributionCents,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId));

  return row!;
}

describe("updateReserve", () => {
  it("writes all three columns to the session's org, and no other", async () => {
    const other = await createOrganization();
    const org = await signedIn();
    await createBuilding(org.id, { timezone: ZONE });

    const today = todayIn(ZONE);
    const result = await updateReserve({
      balance: "18,400",
      asOf: today,
      contribution: "0",
    });

    expect(result).toEqual({ ok: true });
    expect(await reserveOf(org.id)).toEqual({
      balance: 1_840_000,
      asOf: today,
      contribution: 0,
    });
    expect(await reserveOf(other.id)).toEqual({
      balance: null,
      asOf: null,
      contribution: null,
    });
  });

  it("writes nothing when a field is refused", async () => {
    const org = await signedIn();

    const result = await updateReserve({
      balance: "100",
      asOf: "",
      contribution: "50",
    });

    expect(result).toMatchObject({
      ok: false,
      errors: { asOf: expect.any(String) },
    });
    expect((await reserveOf(org.id)).balance).toBeNull();
  });
});

describe("getForecastInputs", () => {
  it("reads the reserve, and only active items on active buildings", async () => {
    const org = await signedIn();
    const building = await createBuilding(org.id, { label: "Rowan Court" });
    const a = await createUnit(org.id, building.id, { label: "A" });
    await createUnit(org.id, building.id, { label: "B" });
    await createUnit(org.id, building.id, { label: "C", status: "retired" });
    const archived = await createBuilding(org.id, { status: "archived" });

    const shared = await createCapitalItem(org.id, building.id);
    const inUnit = await createCapitalItem(org.id, building.id, {
      unitId: a.id,
      label: "Dishwasher",
    });
    await createCapitalItem(org.id, building.id, { status: "removed" });
    await createCapitalItem(org.id, archived.id);

    await testDb()
      .update(organizations)
      .set({
        reserveBalanceCents: 500_000,
        reserveAsOf: "2026-09-01",
        reserveMonthlyContributionCents: 40_000,
      })
      .where(eq(organizations.id, org.id));

    const inputs = await getForecastInputs();

    expect(inputs.reserve).toEqual({
      balanceCents: 500_000,
      asOf: "2026-09-01",
      monthlyContributionCents: 40_000,
    });
    expect(inputs.buildings).toEqual([
      {
        id: building.id,
        name: "Rowan Court",
        timezone: building.timezone,
        unitCount: 2,
      },
    ]);
    expect(
      inputs.items
        .map((item) => [item.id, item.unitLabel])
        .sort(([x], [y]) => (x! < y! ? -1 : 1)),
    ).toEqual(
      [
        [shared.id, null],
        [inUnit.id, "A"],
      ].sort(([x], [y]) => (x! < y! ? -1 : 1)),
    );
  });

  it("answers no reserve until one is entered", async () => {
    await signedIn();

    expect(await getForecastInputs()).toEqual({
      reserve: null,
      buildings: [],
      items: [],
    });
  });
});
