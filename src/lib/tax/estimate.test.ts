/**
 * The liability card and the timing levers. The rate is the one input nobody
 * can check against a record, so the tests hold the module to never inventing
 * one, and to the floor that keeps a loss from reading as a saving.
 */
import { describe, expect, it } from "vitest";

import { depreciationIn } from "@/lib/tax/depreciation";
import {
  estimate,
  liabilityFor,
  type TaxEstimateInput,
} from "@/lib/tax/estimate";
import { type TaxPlan } from "@/lib/tax/statement";

const YEAR = 2026;

let nextId = 0;

function plan(overrides: Partial<TaxPlan> = {}): TaxPlan {
  nextId += 1;
  return {
    id: `p-${String(nextId).padStart(3, "0")}`,
    buildingId: "b1",
    label: "Roof",
    costCents: 1_850_000,
    plannedYear: YEAR,
    plannedMonth: 12,
    classification: "improvement",
    recovery: "residential",
    ...overrides,
  };
}

/**
 * $40,000 of rent against $10,000 of depreciation: $30,000 taxable before any
 * plan, $8,700 at 29%.
 */
function run(overrides: Partial<TaxEstimateInput> = {}) {
  return estimate({
    year: YEAR,
    buildings: [
      {
        id: "b1",
        label: "Hoyt",
        inServiceOn: "2020-03-01",
        buildingBasisCents: 27_500_000,
        rent: { receivedCents: 3_000_000, expectedCents: 1_000_000 },
      },
    ],
    expenses: [],
    items: [],
    plans: [],
    deMinimis: new Map(),
    rateBps: 2_900,
    ...overrides,
  });
}

describe("liabilityFor", () => {
  it("multiplies by the rate and rounds once, to the cent", () => {
    expect(liabilityFor(3_000_000, 2_900)).toBe(870_000);
    expect(liabilityFor(3_333, 2_900)).toBe(967); // 966.57
    expect(liabilityFor(50, 2_900)).toBe(15); // 14.5, half away from zero
  });

  it("is zero for a loss, never negative", () => {
    expect(liabilityFor(-500_000, 2_900)).toBe(0);
    expect(liabilityFor(0, 2_900)).toBe(0);
  });

  it("refuses a rate that is not a whole number of basis points up to 100%", () => {
    expect(() => liabilityFor(100, 2_900.5)).toThrow(RangeError);
    expect(() => liabilityFor(100, 10_001)).toThrow(RangeError);
    expect(() => liabilityFor(100, -1)).toThrow(RangeError);
  });
});

describe("the liability card", () => {
  it("has no liability until a rate is entered", () => {
    const e = run({ rateBps: null });

    expect(e.liability).toBeNull();
    expect(e.statement.taxableCents).toBe(3_000_000);
  });

  it("states the liability and the effective rate on rents", () => {
    const e = run();

    expect(e.liability).toEqual({
      rateBps: 2_900,
      liabilityCents: 870_000,
      loss: false,
      againstDoingNothingCents: 0,
      effectiveRateBps: 2_175, // 8,700 / 40,000
    });
  });

  it("measures this year's calls against leaving every plan undecided", () => {
    const e = run({
      plans: [
        plan({ classification: "repair", costCents: 1_000_000 }),
        // Next year's plan is not this year's call, and moves nothing.
        plan({ plannedYear: YEAR + 1, classification: "repair" }),
      ],
    });

    expect(e.liability?.againstDoingNothingCents).toBe(-290_000);
  });

  it("floors a loss at zero and says it is one", () => {
    const e = run({
      plans: [plan({ classification: "repair", costCents: 5_000_000 })],
    });

    expect(e.statement.taxableCents).toBe(-2_000_000);
    expect(e.liability).toMatchObject({
      liabilityCents: 0,
      loss: true,
      // Only the part of the repair that brought the liability to zero.
      againstDoingNothingCents: -870_000,
      effectiveRateBps: 0,
    });
  });

  it("has no effective rate without rent", () => {
    const e = run({
      buildings: [
        {
          id: "b1",
          label: "Hoyt",
          inServiceOn: null,
          buildingBasisCents: null,
          rent: { receivedCents: 0, expectedCents: 0 },
        },
      ],
    });

    expect(e.liability?.effectiveRateBps).toBeNull();
  });
});

describe("decisions", () => {
  it("states each of this year's calls against leaving that plan undecided", () => {
    const repair = plan({ classification: "repair", costCents: 1_000_000 });
    const roof = plan({ plannedMonth: 12 });
    const undecided = plan({ classification: "unclassified" });
    const e = run({
      plans: [repair, roof, undecided, plan({ plannedYear: YEAR + 1 })],
    });
    const december = depreciationIn(
      1_850_000,
      "residential",
      { year: YEAR, month: 12 },
      YEAR,
    );

    expect(e.decisions).toEqual([
      {
        plan: repair,
        taxableEffectCents: -1_000_000,
        liabilityEffectCents: -290_000,
        underDeMinimis: false,
      },
      {
        plan: roof,
        taxableEffectCents: -december,
        liabilityEffectCents:
          liabilityFor(2_000_000 - december, 2_900) -
          liabilityFor(2_000_000, 2_900),
        underDeMinimis: false,
      },
      {
        plan: undecided,
        taxableEffectCents: 0,
        liabilityEffectCents: 0,
        underDeMinimis: false,
      },
    ]);
  });

  it("says when a plan is under the year's de minimis threshold, and not when the year has none", () => {
    const small = plan({ costCents: 250_000 });

    expect(run({ plans: [small] }).decisions[0]).toMatchObject({
      taxableEffectCents: -250_000,
      underDeMinimis: true,
    });
    expect(
      run({ plans: [small], deMinimis: new Map([[YEAR, null]]) }).decisions[0]
        ?.underDeMinimis,
    ).toBe(false);
  });

  it("returns the year's threshold for the card to name", () => {
    expect(run().deMinimisCents).toBe(250_000);
    expect(run({ deMinimis: new Map([[YEAR, 100_000]]) }).deMinimisCents).toBe(
      100_000,
    );
  });

  it("still states the income a call moves before a rate is entered", () => {
    const e = run({
      rateBps: null,
      plans: [plan({ classification: "repair", costCents: 400_000 })],
    });

    expect(e.decisions[0]).toMatchObject({
      taxableEffectCents: -400_000,
      liabilityEffectCents: null,
    });
  });
});

describe("timing levers", () => {
  it("moving an improvement from December into January takes its depreciation out of the year", () => {
    const roof = plan({ plannedMonth: 12 });
    const e = run({ plans: [roof] });
    const december = depreciationIn(
      1_850_000,
      "residential",
      { year: YEAR, month: 12 },
      YEAR,
    );

    expect(e.levers).toEqual([
      {
        plan: roof,
        from: { year: YEAR, month: 12, assumed: false },
        to: { year: YEAR + 1, month: 1 },
        taxableEffectCents: december,
        liabilityEffectCents:
          liabilityFor(3_000_000, 2_900) -
          liabilityFor(3_000_000 - december, 2_900),
      },
    ]);
  });

  it("moving next year's work into December starts its depreciation a year earlier", () => {
    const roof = plan({ plannedYear: YEAR + 1, plannedMonth: 3 });
    const e = run({ plans: [roof] });

    expect(e.levers[0]).toMatchObject({
      from: { year: YEAR + 1, month: 3 },
      to: { year: YEAR, month: 12 },
      taxableEffectCents: -depreciationIn(
        1_850_000,
        "residential",
        { year: YEAR, month: 12 },
        YEAR,
      ),
    });
  });

  it("moves a repair's whole deduction", () => {
    const e = run({
      plans: [plan({ classification: "repair", costCents: 400_000 })],
    });

    expect(e.levers[0]).toMatchObject({
      taxableEffectCents: 400_000,
      liabilityEffectCents: 116_000,
    });
  });

  it("offers nothing for an undecided plan, or one outside the two years", () => {
    const e = run({
      plans: [
        plan({ classification: "unclassified" }),
        plan({ plannedYear: YEAR + 2 }),
        plan({ plannedYear: YEAR - 1 }),
      ],
    });

    expect(e.levers).toEqual([]);
  });

  it("puts the biggest saving first", () => {
    const small = plan({
      plannedYear: YEAR + 1,
      classification: "repair",
      costCents: 100_000,
    });
    const large = plan({
      plannedYear: YEAR + 1,
      classification: "repair",
      costCents: 900_000,
    });
    const costly = plan({ classification: "repair", costCents: 500_000 });
    const e = run({ plans: [small, costly, large] });

    expect(e.levers.map((l) => l.plan.id)).toEqual([
      large.id,
      small.id,
      costly.id,
    ]);
  });

  it("still states the income a lever moves before a rate is entered", () => {
    const e = run({
      rateBps: null,
      plans: [plan({ classification: "repair", costCents: 400_000 })],
    });

    expect(e.levers[0]).toMatchObject({
      taxableEffectCents: 400_000,
      liabilityEffectCents: null,
    });
  });
});
