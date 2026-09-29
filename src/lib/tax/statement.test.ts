/**
 * The statement. Where it goes wrong silently is in what it counts: a cost
 * counted twice, once from the ledger and once from the item; a building with
 * no basis passing as a smaller deduction; an undecided plan quietly taken as
 * a repair. Each of those is a plausible figure on a tax page, which is the
 * failure CLAUDE.md warns about.
 */
import { describe, expect, it } from "vitest";

import { depreciationIn } from "@/lib/tax/depreciation";
import {
  DEFAULT_DE_MINIMIS_CENTS,
  deMinimisFor,
  statement,
  type StatementInput,
  type TaxBuilding,
  type TaxExpense,
  type TaxItem,
  type TaxPlan,
  underDeMinimis,
} from "@/lib/tax/statement";

const YEAR = 2026;

/** In service since 2020, so a full year: $10,000 on a $275,000 basis. */
function building(overrides: Partial<TaxBuilding> = {}): TaxBuilding {
  return {
    id: "b1",
    label: "Hoyt",
    inServiceOn: "2020-03-01",
    buildingBasisCents: 27_500_000,
    rent: { receivedCents: 0, expectedCents: 0 },
    ...overrides,
  };
}

let nextId = 0;
const id = (prefix: string) => `${prefix}-${String(++nextId).padStart(3, "0")}`;

function expense(overrides: Partial<TaxExpense> = {}): TaxExpense {
  return {
    id: id("x"),
    buildingId: "b1",
    capitalItemId: null,
    label: "Expense",
    occurredOn: `${YEAR}-04-10`,
    amountCents: -10_000,
    category: "utilities",
    classification: null,
    recovery: "residential",
    ...overrides,
  };
}

function item(overrides: Partial<TaxItem> = {}): TaxItem {
  return {
    id: id("i"),
    buildingId: "b1",
    label: "Furnace",
    installYear: 2023,
    installDate: null,
    actualCostCents: 660_000,
    replacesId: null,
    recovery: "residential",
    ...overrides,
  };
}

function plan(overrides: Partial<TaxPlan> = {}): TaxPlan {
  return {
    id: id("p"),
    buildingId: "b1",
    label: "Roof",
    costCents: 1_850_000,
    plannedYear: YEAR,
    plannedMonth: null,
    classification: "improvement",
    recovery: "residential",
    ...overrides,
  };
}

function run(overrides: Partial<StatementInput> = {}) {
  return statement({
    year: YEAR,
    buildings: [building()],
    expenses: [],
    items: [],
    plans: [],
    deMinimis: new Map(),
    ...overrides,
  });
}

describe("gross rental income", () => {
  it("is rent received plus rent expected, per building and in all", () => {
    const s = run({
      buildings: [
        building({
          rent: { receivedCents: 1_404_000, expectedCents: 702_000 },
        }),
        building({
          id: "b2",
          rent: { receivedCents: 100_000, expectedCents: 0 },
        }),
      ],
    });

    expect(s.grossRent).toMatchObject({
      receivedCents: 1_504_000,
      expectedCents: 702_000,
      totalCents: 2_206_000,
    });
    expect(s.grossRent.byBuilding).toHaveLength(2);
  });
});

describe("recorded expenses", () => {
  it("deducts this year's by category, the right way up, net of refunds", () => {
    const s = run({
      expenses: [
        expense({ category: "utilities", amountCents: -30_000 }),
        expense({ category: "utilities", amountCents: 5_000 }), // a refund
        expense({ category: "insurance", amountCents: -120_000 }),
        expense({ category: "insurance", occurredOn: "2025-12-31" }), // last year
      ],
    });

    expect(s.operatingExpenses.totalCents).toBe(145_000);
    expect(
      s.operatingExpenses.byCategory.map((c) => [c.category, c.totalCents]),
    ).toEqual([
      ["insurance", 120_000],
      ["utilities", 25_000],
    ]);
  });

  it("puts mortgage interest on its own line and nowhere else", () => {
    const s = run({
      expenses: [
        expense({ category: "mortgage-interest", amountCents: -400_000 }),
        expense({ category: "taxes", amountCents: -200_000 }),
      ],
    });

    expect(s.mortgageInterest.totalCents).toBe(400_000);
    expect(s.operatingExpenses.totalCents).toBe(200_000);
  });

  it("deducts spend called a repair as filed", () => {
    const s = run({
      expenses: [
        expense({
          category: "repairs",
          classification: "repair",
          amountCents: -15_000,
        }),
      ],
    });

    expect(s.operatingExpenses.byCategory).toEqual([
      expect.objectContaining({ category: "repairs", totalCents: 15_000 }),
    ]);
  });

  it("leaves unclassified spend out of every line, and lists it", () => {
    const undecided = expense({
      category: "repairs",
      classification: "unclassified",
      amountCents: -1_200_000,
    });
    const s = run({ expenses: [undecided] });

    expect(s.operatingExpenses.totalCents).toBe(0);
    expect(s.deductedInFull.totalCents).toBe(0);
    expect(s.improvementDepreciation.totalCents).toBe(0);
    expect(s.notCounted.unclassifiedExpenses).toEqual([undecided]);
  });
});

describe("depreciation, existing basis", () => {
  it("depreciates by the month the building went into service", () => {
    const s = run({
      buildings: [
        building({ id: "full", inServiceOn: "2020-03-01" }),
        building({ id: "jan", inServiceOn: `${YEAR}-01-20` }),
        building({ id: "dec", inServiceOn: `${YEAR}-12-01` }),
      ],
    });

    expect(
      s.buildingDepreciation.rows.map(
        (r) => r.kind === "depreciated" && r.amountCents,
      ),
    ).toEqual([1_000_000, 958_333, 41_667]);
    expect(s.buildingDepreciation.rows[1]).toMatchObject({ halfMonths: 23 });
  });

  it("names a building with no basis and excludes it, never counting it as zero", () => {
    const s = run({
      buildings: [
        building(),
        building({ id: "b2", buildingBasisCents: null }),
        building({ id: "b3", inServiceOn: null }),
      ],
    });

    expect(s.buildingDepreciation.rows.slice(1)).toEqual([
      { buildingId: "b2", kind: "excluded", missing: "basis" },
      { buildingId: "b3", kind: "excluded", missing: "in-service-date" },
    ]);
    expect(s.buildingDepreciation.excludedCount).toBe(2);
    expect(s.buildingDepreciation.totalCents).toBe(1_000_000);
  });

  it("depreciates nothing for a building placed in service after the year", () => {
    const s = run({ buildings: [building({ inServiceOn: "2027-02-01" })] });

    expect(s.buildingDepreciation.rows[0]).toMatchObject({
      kind: "depreciated",
      amountCents: 0,
    });
  });
});

describe("the de minimis safe harbor", () => {
  it("defaults to $2,500 and honours a year's own setting, or none", () => {
    const settings = new Map([
      [2025, null],
      [2026, 100_000],
    ]);

    expect(deMinimisFor(settings, 2024)).toBe(DEFAULT_DE_MINIMIS_CENTS);
    expect(deMinimisFor(settings, 2025)).toBeNull();
    expect(deMinimisFor(settings, 2026)).toBe(100_000);
  });

  it("deducts an improvement at the threshold or under it, and capitalizes one over", () => {
    const at = plan({ label: "At", costCents: 250_000 });
    const under = plan({ label: "Under", costCents: 90_000 });
    const over = plan({ label: "Over", costCents: 250_001 });
    const s = run({ plans: [at, under, over] });

    expect(s.deductedInFull.rows).toEqual([
      expect.objectContaining({
        id: at.id,
        costCents: 250_000,
        reason: "de-minimis",
      }),
      expect.objectContaining({
        id: under.id,
        costCents: 90_000,
        reason: "de-minimis",
      }),
    ]);
    expect(s.improvementDepreciation.rows).toEqual([
      expect.objectContaining({ id: over.id, basisCents: 250_001 }),
    ]);
    expect(s.newBasisCents).toBe(250_001);
  });

  it("capitalizes everything in a year it was not elected", () => {
    const s = run({
      plans: [plan({ costCents: 90_000 })],
      deMinimis: new Map([[YEAR, null]]),
    });

    expect(s.deductedInFull.rows).toEqual([]);
    expect(s.improvementDepreciation.rows).toHaveLength(1);
  });

  it("says on the magnitude, so a refund is judged by its size", () => {
    expect(underDeMinimis(-250_000, 250_000)).toBe(true);
    expect(underDeMinimis(-250_001, 250_000)).toBe(false);
    expect(underDeMinimis(1, null)).toBe(false);
  });
});

describe("this year's plans", () => {
  it("deducts a repair in full, whatever its size", () => {
    const repair = plan({ classification: "repair", costCents: 1_850_000 });
    const s = run({ plans: [repair] });

    expect(s.deductedInFull.rows).toEqual([
      expect.objectContaining({
        id: repair.id,
        costCents: 1_850_000,
        reason: "repair",
      }),
    ]);
    expect(s.newBasisCents).toBe(0);
  });

  it("starts an improvement in July when only its year is known, and says so", () => {
    const roof = plan();
    const s = run({ plans: [roof] });

    expect(s.improvementDepreciation.rows[0]).toMatchObject({
      placedInService: { year: YEAR, month: 7, assumed: true },
      halfMonths: 11,
      amountCents: depreciationIn(
        1_850_000,
        "residential",
        { year: YEAR, month: 7 },
        YEAR,
      ),
    });
  });

  it("uses the month when one was chosen", () => {
    const s = run({ plans: [plan({ plannedMonth: 12 })] });

    expect(s.improvementDepreciation.rows[0]).toMatchObject({
      placedInService: { month: 12, assumed: false },
      halfMonths: 1,
    });
  });

  it("recovers an appliance over five years, not 27.5", () => {
    const s = run({
      plans: [
        plan({ label: "Range", costCents: 300_000, recovery: "five-year" }),
      ],
    });

    expect(s.improvementDepreciation.totalCents).toBe(30_000); // 10%
  });

  it("leaves an undecided plan out of every line, and lists it", () => {
    const undecided = plan({ classification: "unclassified" });
    const s = run({ plans: [undecided] });

    expect(s.deductedInFull.totalCents).toBe(0);
    expect(s.improvementDepreciation.totalCents).toBe(0);
    expect(s.notCounted.unclassifiedPlans).toEqual([undecided]);
  });

  it("ignores plans for other years", () => {
    const s = run({
      plans: [plan({ plannedYear: YEAR - 1 }), plan({ plannedYear: YEAR + 1 })],
    });

    expect(s.improvementDepreciation.rows).toEqual([]);
    expect(s.newBasisCents).toBe(0);
  });
});

describe("improvements from the record", () => {
  it("recovers an improvement on the ledger in every year after it", () => {
    const water = expense({
      label: "Water heater",
      category: "repairs",
      classification: "improvement",
      occurredOn: "2023-09-15",
      amountCents: -660_000,
    });
    const s = run({ expenses: [water] });

    expect(s.improvementDepreciation.rows).toEqual([
      expect.objectContaining({
        source: "ledger",
        basisCents: 660_000,
        placedInService: { year: 2023, month: 9, assumed: false },
        halfMonths: 24,
        amountCents: 24_000, // 660,000 / 27.5
      }),
    ]);
    // Its own year's operating expenses never see it.
    expect(s.operatingExpenses.totalCents).toBe(0);
    expect(s.newBasisCents).toBe(0);
  });

  it("deducts nothing this year for an earlier improvement under that year's threshold", () => {
    const s = run({
      expenses: [
        expense({
          classification: "improvement",
          occurredOn: "2024-05-01",
          amountCents: -200_000,
        }),
      ],
    });

    expect(s.deductedInFull.rows).toEqual([]);
    expect(s.improvementDepreciation.rows).toEqual([]);
  });

  it("places work done before the building went into service with the building", () => {
    const s = run({
      buildings: [building({ inServiceOn: `${YEAR}-06-01` })],
      expenses: [
        expense({
          classification: "improvement",
          occurredOn: `${YEAR}-02-01`,
          amountCents: -1_000_000,
        }),
      ],
    });

    expect(s.improvementDepreciation.rows[0]).toMatchObject({
      placedInService: { year: YEAR, month: 6 },
    });
  });

  it("recovers an installed item whose cost never reached the ledger", () => {
    const furnace = item({ installYear: 2023, installDate: "2023-11-02" });
    const s = run({ items: [furnace] });

    expect(s.improvementDepreciation.rows).toEqual([
      expect.objectContaining({
        source: "item",
        id: furnace.id,
        placedInService: { year: 2023, month: 11, assumed: false },
        amountCents: 24_000,
      }),
    ]);
  });

  it("takes July for an item known only by its year", () => {
    const s = run({ items: [item({ installYear: YEAR })] });

    expect(s.improvementDepreciation.rows[0]).toMatchObject({
      placedInService: { year: YEAR, month: 7, assumed: true },
    });
    expect(s.newBasisCents).toBe(660_000);
  });

  it("never counts an item installed before the building went into service", () => {
    const s = run({
      buildings: [building({ inServiceOn: "2020-03-01" })],
      items: [
        item({ installYear: 2019 }),
        item({ installYear: 2020 }), // same year, no date: taken as basis
        item({ installYear: 2020, installDate: "2020-03-01" }),
        item({ installYear: 2020, installDate: "2020-03-02" }), // after
      ],
    });

    expect(s.improvementDepreciation.rows).toHaveLength(1);
    expect(s.improvementDepreciation.rows[0]).toMatchObject({
      placedInService: { year: 2020, month: 3 },
    });
  });

  it("counts an item's install once when its cost is also on the ledger", () => {
    const furnace = item({ installYear: YEAR });
    const s = run({
      items: [furnace],
      expenses: [
        // Called a repair: deducted as filed, and the item is not also
        // depreciated.
        expense({
          capitalItemId: furnace.id,
          category: "repairs",
          classification: "repair",
          amountCents: -660_000,
        }),
      ],
    });

    expect(s.operatingExpenses.totalCents).toBe(660_000);
    expect(s.improvementDepreciation.rows).toEqual([]);
  });

  it("still recovers an item when the ledger's spend on it came later", () => {
    const furnace = item({ installYear: 2023 });
    const s = run({
      items: [furnace],
      expenses: [
        expense({
          capitalItemId: furnace.id,
          category: "repairs",
          classification: "repair",
        }),
      ],
    });

    expect(s.improvementDepreciation.rows).toEqual([
      expect.objectContaining({ source: "item", id: furnace.id }),
    ]);
  });

  it("takes a bill recorded against the item it replaced as its install", () => {
    const furnace = item({ installYear: YEAR, replacesId: "old-furnace" });
    const s = run({
      items: [furnace],
      expenses: [
        expense({
          capitalItemId: "old-furnace",
          category: "repairs",
          classification: "improvement",
          occurredOn: `${YEAR}-03-02`,
          amountCents: -660_000,
        }),
      ],
    });

    expect(s.improvementDepreciation.rows).toEqual([
      expect.objectContaining({ source: "ledger", basisCents: 660_000 }),
    ]);
    expect(s.notCounted.partlyRecordedItems).toEqual([]);
  });

  it("names an item with less than its cost recorded in its install year", () => {
    // A service call in the year it went in is not its install, and nothing
    // says whether the install is on the ledger elsewhere.
    const furnace = item({ installYear: YEAR });
    const s = run({
      items: [furnace],
      expenses: [
        expense({
          capitalItemId: furnace.id,
          category: "repairs",
          classification: "repair",
          amountCents: -15_000,
        }),
      ],
    });

    expect(s.improvementDepreciation.rows).toEqual([]);
    expect(s.notCounted.partlyRecordedItems).toEqual([furnace]);
  });

  it("skips an item with no known cost, and one not yet installed", () => {
    const s = run({
      items: [
        item({ actualCostCents: null }),
        item({ actualCostCents: 0 }),
        item({ installYear: YEAR + 1 }),
      ],
    });

    expect(s.improvementDepreciation.rows).toEqual([]);
  });

  it("lists an item it cannot place against a building with no in-service date", () => {
    const furnace = item();
    const s = run({
      buildings: [building({ inServiceOn: null })],
      items: [furnace],
    });

    expect(s.improvementDepreciation.rows).toEqual([]);
    expect(s.notCounted.undatedItems).toEqual([furnace]);
  });

  it("lists a ledger improvement on a building with no in-service date", () => {
    const roof = expense({
      classification: "improvement",
      occurredOn: "2024-05-01",
      amountCents: -1_850_000,
    });
    const s = run({
      buildings: [building({ inServiceOn: null })],
      expenses: [roof],
    });

    expect(s.improvementDepreciation.rows).toEqual([]);
    expect(s.notCounted.undatedExpenses).toEqual([roof]);
  });

  it("drops an improvement that is fully recovered", () => {
    // Five years half-year runs six calendar years: 2020 through 2025.
    const s = run({
      items: [
        item({
          installYear: 2020,
          installDate: "2020-06-01",
          actualCostCents: 300_000,
          recovery: "five-year",
        }),
      ],
    });

    expect(s.improvementDepreciation.rows).toEqual([]);
  });
});

describe("taxable rental income", () => {
  it("is gross rent less every deduction line", () => {
    const s = run({
      buildings: [
        building({
          rent: { receivedCents: 3_000_000, expectedCents: 1_000_000 },
        }),
      ],
      expenses: [
        expense({ category: "insurance", amountCents: -200_000 }),
        expense({ category: "mortgage-interest", amountCents: -500_000 }),
      ],
      plans: [
        plan({ classification: "repair", costCents: 300_000 }),
        plan({ plannedMonth: 1, costCents: 2_750_000 }),
      ],
    });

    // 40,000 − 2,000 − 5,000 − 10,000 − 3,000 − 958.33
    expect(s.taxableCents).toBe(
      4_000_000 - 200_000 - 500_000 - 1_000_000 - 300_000 - 95_833,
    );
  });
});

describe("guards", () => {
  it("refuses a row on a building it was not given", () => {
    expect(() => run({ plans: [plan({ buildingId: "elsewhere" })] })).toThrow(
      RangeError,
    );
    expect(() =>
      run({ expenses: [expense({ buildingId: "elsewhere" })] }),
    ).toThrow(RangeError);
  });

  it("refuses a fraction of a cent", () => {
    expect(() => run({ expenses: [expense({ amountCents: -10.5 })] })).toThrow(
      RangeError,
    );
  });
});
