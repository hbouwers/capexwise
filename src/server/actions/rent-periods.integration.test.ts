/**
 * What the rent roll does inside one org: the month a view opens, the rule
 * that a rent change does not reach back into it, the one-click mark and its
 * date, the Other amount form, `Record rent` for a unit with no month, and the
 * building form's refusal to delete a unit that has rent history. The
 * cross-org half is the isolation test's.
 *
 * Driven as the page drives them — a signed session, then the function — as
 * `building-facts.integration.test.ts` does, whose session setup this repeats.
 * "Today" is the real one, read in the building's zone as the code reads it.
 */
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { buildings, rentPeriods, units } from "@/db/schema";
import { buildingFields } from "@/lib/building-form";
import { addMonths, firstOfMonth, todayIn } from "@/lib/dates";
import { UNREADABLE_FORM } from "@/lib/forms";
import { monthParam } from "@/lib/rent";
import {
  newRentPeriodFields,
  type RentPeriodFields,
} from "@/lib/rent-period-form";
import { applicationDatabaseUrl, testDb } from "@/test/db";
import {
  createBuilding,
  createMembership,
  createOrganization,
  createRentPeriod,
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
const { markRentPaid, openRentPeriod, saveRentPeriod, unmarkRentPaid } =
  await import("@/server/actions/rent-periods");
const { updateBuilding } = await import("@/server/actions/buildings");
const { getRentRoll } = await import("@/server/queries/rent-periods");
const { getBuilding } = await import("@/server/queries/buildings");

const ZONE = "America/Indiana/Indianapolis";
const today = todayIn(ZONE);
const thisMonth = firstOfMonth(today);
const lastMonth = addMonths(thisMonth, -1);

/**
 * A duplex, its owner signed in as the requests below: A let at $2,300, B
 * vacant with an asking rent of $1,950.
 */
async function duplex() {
  const org = await createOrganization();
  const owner = await createUser();
  await createMembership(org.id, owner.id, { role: "owner" });

  const context = await getAuth().$context;
  const session = await context.internalAdapter.createSession(owner.id, false);
  const signature = await makeSignature(session.token, context.secret);

  request.headers = new Headers({
    cookie: `${context.authCookies.sessionToken.name}=${session.token}.${signature}`,
  });

  const building = await createBuilding(org.id, { timezone: ZONE });
  const a = await createUnit(org.id, building.id, {
    label: "A",
    status: "occupied",
    rentCents: 230_000,
  });
  const b = await createUnit(org.id, building.id, {
    label: "B",
    status: "vacant",
    rentCents: 195_000,
  });

  return { org, building, a, b };
}

async function periodsOf(unitId: string) {
  return await testDb()
    .select()
    .from(rentPeriods)
    .where(eq(rentPeriods.unitId, unitId))
    .orderBy(rentPeriods.periodMonth);
}

async function periodRow(id: string) {
  const [row] = await testDb()
    .select()
    .from(rentPeriods)
    .where(eq(rentPeriods.id, id));

  return row!;
}

function form(overrides: Partial<RentPeriodFields> = {}): RentPeriodFields {
  return {
    expected: "$2,300",
    received: "",
    receivedOn: today,
    note: "",
    vacant: false,
    ...overrides,
  };
}

describe("getRentRoll", () => {
  it("opens the month for the occupied unit, at its rent, and for nothing else", async () => {
    const { building, a, b } = await duplex();

    const roll = await getRentRoll(building.id, undefined);

    expect(roll?.month).toBe(thisMonth);
    expect(roll?.rows.map((row) => [row.unit.label, row.period])).toEqual([
      [
        "A",
        expect.objectContaining({
          periodMonth: thisMonth,
          amountExpectedCents: 230_000,
          amountReceivedCents: null,
          vacant: false,
        }),
      ],
      // Vacant: no period, and no zero standing in for one.
      ["B", null],
    ]);
    expect(await periodsOf(b.id)).toEqual([]);
    expect(await periodsOf(a.id)).toHaveLength(1);
  });

  it("does not move an opened month when the rent changes", async () => {
    // The rule data-model §4 calls the most important in the table: a March
    // increase must not rewrite January.
    const { building, a } = await duplex();
    await getRentRoll(building.id, undefined);

    await testDb()
      .update(units)
      .set({ rentCents: 245_000 })
      .where(eq(units.id, a.id));

    const roll = await getRentRoll(building.id, undefined);
    expect(roll?.rows[0]?.period?.amountExpectedCents).toBe(230_000);

    // A month opened after the change snapshots the new figure.
    const earlier = await getRentRoll(building.id, monthParam(lastMonth));
    expect(earlier?.rows[0]?.period?.amountExpectedCents).toBe(245_000);
  });

  it("opens one month per unit however many views race for it", async () => {
    const { building, a } = await duplex();

    await Promise.all(
      Array.from({ length: 5 }, () => getRentRoll(building.id, undefined)),
    );

    expect(await periodsOf(a.id)).toHaveLength(1);
  });

  it("opens an earlier month when it is viewed, and never a later one", async () => {
    const { building, a } = await duplex();

    const past = await getRentRoll(building.id, monthParam(lastMonth));
    expect(past?.month).toBe(lastMonth);

    const future = await getRentRoll(
      building.id,
      monthParam(addMonths(thisMonth, 1)),
    );
    expect(future?.month).toBe(thisMonth);

    expect((await periodsOf(a.id)).map((p) => p.periodMonth)).toEqual([
      lastMonth,
      thisMonth,
    ]);
  });

  it("opens nothing on an archived building, and shows its units", async () => {
    const { building, a } = await duplex();
    await testDb()
      .update(buildings)
      .set({ status: "archived" })
      .where(eq(buildings.id, building.id));

    const roll = await getRentRoll(building.id, undefined);

    expect(roll?.editable).toBe(false);
    expect(roll?.rows.map((row) => row.period)).toEqual([null, null]);
    expect(await periodsOf(a.id)).toEqual([]);
  });

  it("names the earlier months nobody finished, on the current month only", async () => {
    const { org, building, a, b } = await duplex();
    const twoBack = addMonths(thisMonth, -2);
    await createRentPeriod(org.id, building.id, a.id, {
      periodMonth: lastMonth,
    });
    await createRentPeriod(org.id, building.id, a.id, {
      periodMonth: twoBack,
    });
    // Marked, and vacant: neither is a month left unfinished.
    await createRentPeriod(org.id, building.id, b.id, {
      periodMonth: twoBack,
      amountReceivedCents: 195_000,
      receivedOn: twoBack,
    });
    await createRentPeriod(org.id, building.id, b.id, {
      periodMonth: lastMonth,
      vacant: true,
    });

    const roll = await getRentRoll(building.id, undefined);
    expect(roll?.unmarked).toEqual([
      { month: lastMonth, count: 1 },
      { month: twoBack, count: 1 },
    ]);

    const past = await getRentRoll(building.id, monthParam(lastMonth));
    expect(past?.unmarked).toEqual([]);
  });

  it("keeps a retired unit's month, and leaves it out where it has none", async () => {
    const { org, building, b } = await duplex();
    await createRentPeriod(org.id, building.id, b.id, {
      periodMonth: lastMonth,
      amountExpectedCents: 195_000,
    });
    await testDb()
      .update(units)
      .set({ status: "retired" })
      .where(eq(units.id, b.id));

    const past = await getRentRoll(building.id, monthParam(lastMonth));
    expect(past?.rows.map((row) => row.unit.label)).toEqual(["A", "B"]);

    const now = await getRentRoll(building.id, undefined);
    expect(now?.rows.map((row) => row.unit.label)).toEqual(["A"]);
  });
});

describe("markRentPaid", () => {
  it("records the expected amount, today, for the current month", async () => {
    const { org, building, a } = await duplex();
    const period = await createRentPeriod(org.id, building.id, a.id, {
      periodMonth: thisMonth,
    });

    expect(await markRentPaid(period.id)).toEqual({ ok: true });
    expect(await periodRow(period.id)).toMatchObject({
      amountReceivedCents: 230_000,
      receivedOn: today,
    });
  });

  it("records an earlier month on its first day, not today", async () => {
    const { org, building, a } = await duplex();
    const period = await createRentPeriod(org.id, building.id, a.id, {
      periodMonth: lastMonth,
    });

    expect(await markRentPaid(period.id)).toEqual({ ok: true });
    expect((await periodRow(period.id)).receivedOn).toBe(lastMonth);
  });

  it("refuses a month already marked, so an Undo cannot clear another payment", async () => {
    const { org, building, a } = await duplex();
    const period = await createRentPeriod(org.id, building.id, a.id, {
      periodMonth: thisMonth,
      amountReceivedCents: 120_000,
      receivedOn: thisMonth,
    });

    expect(await markRentPaid(period.id)).toEqual({ ok: false });
    expect((await periodRow(period.id)).amountReceivedCents).toBe(120_000);
  });

  it("refuses a vacant month, and one on an archived building", async () => {
    const { org, building, a } = await duplex();
    const vacant = await createRentPeriod(org.id, building.id, a.id, {
      periodMonth: lastMonth,
      vacant: true,
    });
    const open = await createRentPeriod(org.id, building.id, a.id, {
      periodMonth: thisMonth,
    });

    expect(await markRentPaid(vacant.id)).toEqual({ ok: false });

    await testDb()
      .update(buildings)
      .set({ status: "archived" })
      .where(eq(buildings.id, building.id));

    expect(await markRentPaid(open.id)).toEqual({ ok: false });
    expect((await periodRow(open.id)).amountReceivedCents).toBeNull();
  });

  it("refuses something that is not an id", async () => {
    await duplex();

    expect(await markRentPaid("not-an-id")).toEqual({ ok: false });
    expect(await markRentPaid({ id: "x" })).toEqual({ ok: false });
  });
});

describe("unmarkRentPaid", () => {
  it("takes the payment off and keeps the expected amount and the note", async () => {
    const { org, building, a } = await duplex();
    const period = await createRentPeriod(org.id, building.id, a.id, {
      periodMonth: thisMonth,
      amountExpectedCents: 215_000,
      amountReceivedCents: 215_000,
      receivedOn: thisMonth,
      note: "prorated",
    });

    expect(await unmarkRentPaid(period.id)).toEqual({ ok: true });
    expect(await periodRow(period.id)).toMatchObject({
      amountExpectedCents: 215_000,
      amountReceivedCents: null,
      receivedOn: null,
      note: "prorated",
    });

    // A second press has nothing to take off.
    expect(await unmarkRentPaid(period.id)).toEqual({ ok: false });
  });
});

describe("saveRentPeriod", () => {
  it("records a partial payment, and corrects the expected amount", async () => {
    const { org, building, a } = await duplex();
    const period = await createRentPeriod(org.id, building.id, a.id, {
      periodMonth: lastMonth,
    });
    const sixth = lastMonth.replace(/01$/, "06");

    const result = await saveRentPeriod(
      period.id,
      form({
        expected: "2,150",
        received: "1,200",
        receivedOn: sixth,
        note: "rest promised",
      }),
    );

    expect(result).toEqual({ ok: true });
    expect(await periodRow(period.id)).toMatchObject({
      amountExpectedCents: 215_000,
      amountReceivedCents: 120_000,
      receivedOn: sixth,
      note: "rest promised",
    });
  });

  it("marks a month vacant, dropping what was received", async () => {
    // #97's first case: occupied now, empty then.
    const { org, building, a } = await duplex();
    const period = await createRentPeriod(org.id, building.id, a.id, {
      periodMonth: lastMonth,
    });

    const result = await saveRentPeriod(
      period.id,
      form({ received: "2,300", receivedOn: lastMonth, vacant: true }),
    );

    expect(result).toEqual({ ok: true });
    expect(await periodRow(period.id)).toMatchObject({
      vacant: true,
      amountExpectedCents: 230_000,
      amountReceivedCents: null,
    });

    const roll = await getRentRoll(building.id, monthParam(lastMonth));
    expect(roll?.rows[0]?.period?.vacant).toBe(true);
  });

  it("answers with the form's messages, and writes nothing", async () => {
    const { org, building, a } = await duplex();
    const period = await createRentPeriod(org.id, building.id, a.id, {
      periodMonth: thisMonth,
    });

    const result = await saveRentPeriod(
      period.id,
      form({ received: "2,300", receivedOn: addMonths(thisMonth, 2) }),
    );

    expect(result).toEqual({
      ok: false,
      errors: { receivedOn: "Enter today’s date or an earlier one." },
    });
    expect((await periodRow(period.id)).amountReceivedCents).toBeNull();
  });
});

describe("openRentPeriod", () => {
  it("records rent for a month the unit was let, though it is vacant now", async () => {
    // #97's second case.
    const { building, b } = await duplex();

    const result = await openRentPeriod(b.id, lastMonth, {
      ...newRentPeriodFields(lastMonth, 195_000, today),
      expected: "1,900",
      received: "1,900",
    });

    expect(result).toEqual({ ok: true });
    expect(await periodsOf(b.id)).toEqual([
      expect.objectContaining({
        buildingId: building.id,
        periodMonth: lastMonth,
        amountExpectedCents: 190_000,
        amountReceivedCents: 190_000,
        receivedOn: lastMonth,
        vacant: false,
      }),
    ]);
  });

  it("reports a month that is already open rather than opening it twice", async () => {
    const { org, building, b } = await duplex();
    await createRentPeriod(org.id, building.id, b.id, {
      periodMonth: lastMonth,
    });

    const result = await openRentPeriod(b.id, lastMonth, form());

    expect(result.ok).toBe(false);
    expect(await periodsOf(b.id)).toHaveLength(1);
  });

  it.each([
    ["a month still to come", () => addMonths(thisMonth, 1)],
    ["a month before the switcher reaches", () => addMonths(thisMonth, -25)],
    [
      "a day that is not a month's first",
      () => today.replace(/-\d{2}$/, "-15"),
    ],
  ])("refuses %s", async (_, month) => {
    const { b } = await duplex();

    expect((await openRentPeriod(b.id, month(), form())).ok).toBe(false);
    expect(await periodsOf(b.id)).toEqual([]);
  });

  it("refuses a retired unit, and a month opened as vacant", async () => {
    const { a, b } = await duplex();
    await testDb()
      .update(units)
      .set({ status: "retired" })
      .where(eq(units.id, b.id));

    expect((await openRentPeriod(b.id, lastMonth, form())).ok).toBe(false);
    expect(
      await openRentPeriod(a.id, lastMonth, form({ vacant: true })),
    ).toEqual({ ok: false, errors: { form: UNREADABLE_FORM } });
    expect(await periodsOf(a.id)).toEqual([]);
  });
});

describe("updateBuilding, once a unit has rent history", () => {
  it("refuses to remove the unit, and says to retire it", async () => {
    const { org, building, a, b } = await duplex();
    await createRentPeriod(org.id, building.id, a.id);
    const detail = (await getBuilding(building.id))!;

    const fields = buildingFields(detail.building, detail.units);
    const result = await updateBuilding(building.id, {
      ...fields,
      units: fields.units.filter((unit) => unit.id === b.id),
    });

    expect(result).toEqual({
      ok: false,
      errors: {
        units:
          "Unit “A” has rent recorded, so it can’t be removed. Retire it instead — its months stay on the rent roll.",
      },
    });
    expect(await periodsOf(a.id)).toHaveLength(1);
  });

  it("retires it, and its months stay", async () => {
    const { org, building, a } = await duplex();
    await createRentPeriod(org.id, building.id, a.id);
    const detail = (await getBuilding(building.id))!;

    expect(detail.units.map((unit) => unit.hasRentHistory)).toEqual([
      true,
      false,
    ]);

    const fields = buildingFields(detail.building, detail.units);
    const result = await updateBuilding(building.id, {
      ...fields,
      units: fields.units.map((unit) =>
        unit.id === a.id ? { ...unit, status: "retired" as const } : unit,
      ),
    });

    expect(result).toEqual({ ok: true, buildingId: building.id });
    expect(await periodsOf(a.id)).toHaveLength(1);
  });
});
