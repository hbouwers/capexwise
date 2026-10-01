/**
 * The tax planner inside one org: what `getTaxInputs` hands the module, and
 * the page's two writes. The cross-org half is the isolation test's.
 *
 * Driven as the page drives them — a signed session, then the function — as
 * `planned-work.integration.test.ts` does, whose session setup this repeats.
 * The read takes a fixed instant, so which months are behind and which are
 * still to come does not depend on the day the suite runs.
 */
import { makeSignature } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { plannedWork, taxYears } from "@/db/schema";
import { todayIn, yearOf } from "@/lib/dates";
import { applicationDatabaseUrl, testDb } from "@/test/db";
import {
  createBuilding,
  createCapitalItem,
  createMembership,
  createOrganization,
  createPlannedWork,
  createRentPeriod,
  createTaxYear,
  createTransaction,
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
const { classifyPlan, setTaxRate } = await import("@/server/actions/tax");
const { getTaxInputs } = await import("@/server/queries/tax");

const ZONE = "America/Indiana/Indianapolis";
/** Mid-September 2026 in Indianapolis. */
const NOW = new Date("2026-09-15T16:00:00Z");
/** The year `setTaxRate` writes, which is the real one. */
const THIS_YEAR = yearOf(todayIn(ZONE));

/** An org with its owner signed in, and a building on it. */
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

  const building = await createBuilding(org.id, {
    timezone: ZONE,
    inServiceOn: "2019-06-01",
    purchasePriceCents: 30_000_000,
    landBasisCents: 5_000_000,
    buildingBasisCents: 25_000_000,
  });

  return { org, building };
}

describe("getTaxInputs", () => {
  it("sums each building's rent: received to date, and the rest of the year expected", async () => {
    const { org, building } = await signedIn();
    const unit = await createUnit(org.id, building.id, {
      status: "occupied",
      rentCents: 150_000,
    });
    await createRentPeriod(org.id, building.id, unit.id, {
      periodMonth: "2026-07-01",
      amountExpectedCents: 150_000,
      amountReceivedCents: 150_000,
      receivedOn: "2026-07-01",
    });
    // Opened and never marked: counted for nothing, and counted.
    await createRentPeriod(org.id, building.id, unit.id, {
      periodMonth: "2026-08-01",
      amountExpectedCents: 150_000,
    });

    const inputs = await getTaxInputs(NOW);

    expect(inputs.year).toBe(2026);
    expect(inputs.buildings).toEqual([
      expect.objectContaining({
        id: building.id,
        inServiceOn: "2019-06-01",
        buildingBasisCents: 25_000_000,
        unitCount: 1,
        unmarkedRentPeriods: 1,
        // September, opened by the read, then October to December.
        rent: { receivedCents: 150_000, expectedCents: 4 * 150_000 },
      }),
    ]);
  });

  it("reads the ledger to the end of the year, with each expense's recovery from its item's type", async () => {
    const { org, building } = await signedIn();
    const washer = await createCapitalItem(org.id, building.id, {
      typeSlug: "washer",
      label: "Washer",
      installYear: 2024,
    });
    const custom = await createCapitalItem(org.id, building.id, {
      typeSlug: null,
      label: "Stackable washer",
    });
    const onWasher = await createTransaction(org.id, building.id, {
      capitalItemId: washer.id,
      occurredOn: "2024-05-01",
      amountCents: -90_000,
      description: null,
      classification: "improvement",
    });
    const onCustom = await createTransaction(org.id, building.id, {
      capitalItemId: custom.id,
      occurredOn: "2026-02-01",
    });
    await createTransaction(org.id, building.id, { occurredOn: "2027-01-02" });

    const { expenses } = await getTaxInputs(NOW);

    expect(expenses).toHaveLength(2);
    expect(expenses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: onWasher.id,
          // No description, so the item's name.
          label: "Washer",
          recovery: "five_year",
          classification: "improvement",
        }),
        // An item with no catalogue type recovers as the building does.
        expect.objectContaining({ id: onCustom.id, recovery: "residential" }),
      ]),
    );
  });

  it("reads every item, with the one each replaced", async () => {
    const { org, building } = await signedIn();
    const newer = await createCapitalItem(org.id, building.id, {
      installYear: 2025,
      actualCostCents: 500_000,
    });
    const older = await createCapitalItem(org.id, building.id, {
      status: "replaced",
      replacedById: newer.id,
    });

    const { items } = await getTaxInputs(NOW);

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: newer.id,
          replacesId: older.id,
          actualCostCents: 500_000,
          recovery: "residential",
        }),
        expect.objectContaining({ id: older.id, replacesId: null }),
      ]),
    );
  });

  it("reads this year's and next year's live plans, an item's from the item", async () => {
    const { org, building } = await signedIn();
    const fridge = await createCapitalItem(org.id, building.id, {
      typeSlug: "refrigerator",
      label: "Refrigerator",
      replacementCostCents: 140_000,
    });
    const itemPlan = await createPlannedWork(org.id, building.id, {
      capitalItemId: fridge.id,
      plannedYear: 2026,
      plannedMonth: 11,
      classification: "improvement",
    });
    const project = await createPlannedWork(org.id, building.id, {
      title: "Basement remodel",
      estCostCents: 2_400_000,
      plannedYear: 2027,
    });
    // Neither live nor near: left out.
    await createPlannedWork(org.id, building.id, {
      title: "Porch",
      estCostCents: 300_000,
      plannedYear: 2026,
      status: "dropped",
    });
    await createPlannedWork(org.id, building.id, {
      title: "Siding",
      estCostCents: 900_000,
      plannedYear: 2028,
    });

    const { plans } = await getTaxInputs(NOW);

    expect(plans).toHaveLength(2);
    expect(plans).toEqual(
      expect.arrayContaining([
        {
          id: itemPlan.id,
          buildingId: building.id,
          capitalItemId: fridge.id,
          unitLabel: null,
          label: "Refrigerator",
          costCents: 140_000,
          plannedYear: 2026,
          plannedMonth: 11,
          classification: "improvement",
          recovery: "five_year",
        },
        expect.objectContaining({
          id: project.id,
          capitalItemId: null,
          label: "Basement remodel",
          costCents: 2_400_000,
          classification: "unclassified",
          recovery: "residential",
        }),
      ]),
    );
  });

  it("reads the year's rate, and each year's threshold or its absence", async () => {
    const { org } = await signedIn();
    await createTaxYear(org.id, { year: 2026, blendedRateBps: 2_900 });
    await createTaxYear(org.id, { year: 2025, deMinimisElected: false });

    const inputs = await getTaxInputs(NOW);

    expect(inputs.rateBps).toBe(2_900);
    expect(inputs.deMinimis).toEqual(
      new Map([
        [2026, 250_000],
        [2025, null],
      ]),
    );
  });

  it("has no rate for a year nobody entered one", async () => {
    await signedIn();

    expect((await getTaxInputs(NOW)).rateBps).toBeNull();
  });

  it("leaves an archived building out, with everything on it", async () => {
    const { org } = await signedIn();
    const archived = await createBuilding(org.id, { status: "archived" });
    await createTransaction(org.id, archived.id);
    await createPlannedWork(org.id, archived.id, {
      title: "Roof",
      estCostCents: 1_000_000,
      plannedYear: 2026,
    });

    const inputs = await getTaxInputs(NOW);

    expect(inputs.buildings).toHaveLength(1);
    expect(inputs.expenses).toEqual([]);
    expect(inputs.plans).toEqual([]);
  });
});

describe("classifyPlan", () => {
  async function classificationOf(planId: string) {
    const [row] = await testDb()
      .select({ classification: plannedWork.classification })
      .from(plannedWork)
      .where(eq(plannedWork.id, planId));

    return row?.classification;
  }

  it("saves the call, and takes it back", async () => {
    const { org, building } = await signedIn();
    const plan = await createPlannedWork(org.id, building.id, {
      title: "Roof",
      estCostCents: 1_850_000,
      plannedYear: 2026,
    });

    expect(await classifyPlan(plan.id, "improvement")).toEqual({ ok: true });
    expect(await classificationOf(plan.id)).toBe("improvement");

    expect(await classifyPlan(plan.id, "unclassified")).toEqual({ ok: true });
    expect(await classificationOf(plan.id)).toBe("unclassified");
  });

  it("refuses a plan that is no longer live, or on an archived building", async () => {
    const { org, building } = await signedIn();
    const dropped = await createPlannedWork(org.id, building.id, {
      title: "Porch",
      estCostCents: 300_000,
      status: "dropped",
    });
    const archived = await createBuilding(org.id, { status: "archived" });
    const onArchived = await createPlannedWork(org.id, archived.id, {
      title: "Roof",
      estCostCents: 1_000_000,
    });

    for (const plan of [dropped, onArchived]) {
      expect(await classifyPlan(plan.id, "repair")).toEqual({ ok: false });
      expect(await classificationOf(plan.id)).toBe("unclassified");
    }
  });

  it("refuses what the control could not have sent", async () => {
    const { org, building } = await signedIn();
    const plan = await createPlannedWork(org.id, building.id, {
      title: "Roof",
      estCostCents: 1_000_000,
    });

    expect(await classifyPlan(plan.id, "capital")).toEqual({ ok: false });
    expect(await classifyPlan("not-an-id", "repair")).toEqual({ ok: false });
    expect(await classificationOf(plan.id)).toBe("unclassified");
  });
});

describe("setTaxRate", () => {
  async function yearsOf(orgId: string) {
    return await testDb()
      .select({
        year: taxYears.year,
        blendedRateBps: taxYears.blendedRateBps,
        deMinimisElected: taxYears.deMinimisElected,
        deMinimisThresholdCents: taxYears.deMinimisThresholdCents,
      })
      .from(taxYears)
      .where(eq(taxYears.orgId, orgId));
  }

  it("makes this year's row with the first rate, and the de minimis defaults", async () => {
    const { org } = await signedIn();

    expect(await setTaxRate({ rate: "29" })).toEqual({ ok: true });
    expect(await yearsOf(org.id)).toEqual([
      {
        year: THIS_YEAR,
        blendedRateBps: 2_900,
        deMinimisElected: true,
        deMinimisThresholdCents: 250_000,
      },
    ]);
  });

  it("changes the rate and leaves the year's other settings alone", async () => {
    const { org } = await signedIn();
    await createTaxYear(org.id, {
      year: THIS_YEAR,
      blendedRateBps: 2_900,
      deMinimisElected: false,
      deMinimisThresholdCents: 100_000,
    });

    expect(await setTaxRate({ rate: "31.5%" })).toEqual({ ok: true });
    expect(await yearsOf(org.id)).toEqual([
      {
        year: THIS_YEAR,
        blendedRateBps: 3_150,
        deMinimisElected: false,
        deMinimisThresholdCents: 100_000,
      },
    ]);
  });

  it("says what to change, and writes nothing", async () => {
    const { org } = await signedIn();

    expect(await setTaxRate({ rate: "" })).toEqual({
      ok: false,
      errors: { rate: "Enter your blended rate, as a percentage." },
    });
    expect(await setTaxRate({ rate: "140" })).toMatchObject({ ok: false });
    expect(
      await testDb()
        .select()
        .from(taxYears)
        .where(and(eq(taxYears.orgId, org.id))),
    ).toEqual([]);
  });
});
