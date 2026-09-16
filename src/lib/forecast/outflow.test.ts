/**
 * The ten-year capital plan. Where this goes wrong silently is at the edges of
 * the window — an item due exactly this year, one decades late, one that comes
 * round again before year ten — and in the split between audited and
 * estimated cost, which the chart stacks and nothing else checks.
 */
import { describe, expect, it } from "vitest";

import { lifeStatus } from "@/lib/forecast/life";
import {
  BIG_TICKET_CENTS,
  estimateSpreadYears,
  type ForecastItem,
  levelFundingPerMonthCents,
  outflowByYear,
  replacements,
  tenYearTotalCents,
} from "@/lib/forecast/outflow";

const THIS_YEAR = 2026;

let nextId = 0;

/** An audited $1,000 item with a 20-year life, due this year unless told. */
function item(overrides: Partial<ForecastItem> = {}): ForecastItem {
  nextId += 1;
  return {
    id: `item-${String(nextId).padStart(3, "0")}`,
    label: `Item ${nextId}`,
    installYear: THIS_YEAR - 20,
    expectedLifeYears: 20,
    replacementCostCents: 100_000,
    confidence: "audited",
    status: "active",
    ...overrides,
  };
}

function yearsOf(found: ReturnType<typeof replacements>): number[] {
  return found.map((r) => r.year).sort((a, b) => a - b);
}

describe("replacements", () => {
  it("lands an item due exactly this year this year, tagged Due", () => {
    const [first] = replacements([item()], THIS_YEAR);

    expect(first).toMatchObject({
      year: THIS_YEAR,
      naturalYear: THIS_YEAR,
      occurrence: 0,
      tag: "due",
    });
  });

  it("folds an item past due by decades into this year, tagged Overdue", () => {
    const found = replacements(
      [item({ installYear: 1950, expectedLifeYears: 20 })],
      THIS_YEAR,
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      year: THIS_YEAR,
      naturalYear: 1970,
      tag: "overdue",
    });
  });

  it("makes this year's replacements the End of life tile's items", () => {
    const items = [
      item({ installYear: 1990 }), // past due
      item({ installYear: THIS_YEAR - 20 }), // due this year
      item({ installYear: THIS_YEAR - 19 }), // next year
      item({ installYear: THIS_YEAR - 5, confidence: "estimated" }),
      item({ installYear: 2000, status: "replaced" }),
    ];

    const thisYears = replacements(items, THIS_YEAR)
      .filter((r) => r.year === THIS_YEAR)
      .map((r) => r.item.id)
      .sort();
    const endOfLife = items
      .filter(
        (i) =>
          i.status === "active" && lifeStatus(i, THIS_YEAR) === "past-life",
      )
      .map((i) => i.id)
      .sort();

    expect(thisYears).toEqual(endOfLife);
    expect(thisYears).toHaveLength(2);
  });

  it("stops at nine years out", () => {
    expect(
      replacements([item({ installYear: THIS_YEAR - 11 })], THIS_YEAR),
    ).toHaveLength(1); // 2035
    expect(
      replacements([item({ installYear: THIS_YEAR - 10 })], THIS_YEAR),
    ).toHaveLength(0); // 2036
  });

  it("brings an item round again a life after the year it lands", () => {
    const detector = item({ installYear: 2021, expectedLifeYears: 5 });
    const found = replacements([detector], THIS_YEAR);

    expect(yearsOf(found)).toEqual([2026, 2031]);
    expect(found[1]).toMatchObject({ naturalYear: 2031, occurrence: 1 });
  });

  it("times a past-due item's recurrence from this year, not its real year", () => {
    const found = replacements(
      [item({ installYear: 2010, expectedLifeYears: 5 })],
      THIS_YEAR,
    );

    // Due 2015; replaced now, so next due 2031, not 2020 or 2025.
    expect(yearsOf(found)).toEqual([2026, 2031]);
    expect(found.find((r) => r.year === 2031)?.tag).toBe("planned");
  });

  it("counts a one-year life in every one of the ten years", () => {
    const found = replacements(
      [item({ installYear: 2025, expectedLifeYears: 1 })],
      THIS_YEAR,
    );

    expect(yearsOf(found)).toEqual([
      2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035,
    ]);
  });

  it("leaves out replaced and removed items", () => {
    expect(
      replacements(
        [item({ status: "replaced" }), item({ status: "removed" })],
        THIS_YEAR,
      ),
    ).toEqual([]);
  });

  it("tags a later year Big ticket from exactly the threshold", () => {
    const later = { installYear: THIS_YEAR - 17 };

    expect(
      replacements(
        [item({ ...later, replacementCostCents: BIG_TICKET_CENTS })],
        THIS_YEAR,
      )[0]?.tag,
    ).toBe("big-ticket");
    expect(
      replacements(
        [item({ ...later, replacementCostCents: BIG_TICKET_CENTS - 1 })],
        THIS_YEAR,
      )[0]?.tag,
    ).toBe("planned");
    // This year's tag says when, whatever it costs.
    expect(
      replacements([item({ replacementCostCents: 2_000_000 })], THIS_YEAR)[0]
        ?.tag,
    ).toBe("due");
  });

  describe("an estimated install year", () => {
    it("widens to a fifth of the life either side, and keeps the point", () => {
      const roof = item({
        installYear: 2014,
        expectedLifeYears: 15,
        confidence: "estimated",
      });

      expect(replacements([roof], THIS_YEAR)[0]).toMatchObject({
        year: 2029,
        range: { from: 2026, to: 2032 },
      });
    });

    it("folds the early end of the window into this year", () => {
      const found = replacements(
        [
          item({
            installYear: 2011,
            expectedLifeYears: 15,
            confidence: "estimated",
          }),
        ],
        THIS_YEAR,
      );

      // Point 2026, ±3: 2023–2029, of which 2023–2025 is already behind us.
      expect(found[0]?.range).toEqual({ from: 2026, to: 2029 });
    });

    it("has no range once the whole window is past", () => {
      const found = replacements(
        [item({ installYear: 1950, confidence: "estimated" })],
        THIS_YEAR,
      );

      expect(found[0]?.range).toBeNull();
    });

    it("has no range when audited", () => {
      expect(
        replacements([item({ installYear: 2014 })], THIS_YEAR)[0]?.range,
      ).toBeNull();
    });
  });

  describe("a deferral", () => {
    it("moves the next replacement and every one after it", () => {
      const detector = item({ installYear: 2022, expectedLifeYears: 5 });
      const found = replacements(
        [detector],
        THIS_YEAR,
        new Map([[detector.id, 2]]),
      );

      expect(yearsOf(found)).toEqual([2029, 2034]);
      expect(found.find((r) => r.year === 2029)?.deferredBy).toBe(2);
      expect(found.find((r) => r.year === 2034)?.deferredBy).toBe(0);
    });

    it("moves a past-due item from this year, not from its real year", () => {
      const late = item({ installYear: 1990 });
      const [moved] = replacements([late], THIS_YEAR, new Map([[late.id, 1]]));

      expect(moved).toMatchObject({ year: 2027, naturalYear: 2010 });
      expect(moved?.tag).not.toBe("overdue");
    });

    it("moves an estimated item's range with it", () => {
      const roof = item({
        installYear: 2014,
        expectedLifeYears: 15,
        confidence: "estimated",
      });
      const [moved] = replacements([roof], THIS_YEAR, new Map([[roof.id, 3]]));

      expect(moved).toMatchObject({
        year: 2032,
        range: { from: 2029, to: 2035 },
      });
    });

    it("can push a replacement past the ten years", () => {
      const last = item({ installYear: THIS_YEAR - 11 }); // 2035

      expect(replacements([last], THIS_YEAR, new Map([[last.id, 1]]))).toEqual(
        [],
      );
    });

    it("ignores an id that names no item", () => {
      expect(
        replacements([item()], THIS_YEAR, new Map([["gone", 1]])),
      ).toHaveLength(1);
    });

    it("is one, two or three years", () => {
      const one = item();

      for (const years of [0, 4, -1, 1.5]) {
        expect(() =>
          replacements([one], THIS_YEAR, new Map([[one.id, years]])),
        ).toThrow(RangeError);
      }
    });
  });
});

describe("estimateSpreadYears", () => {
  it("is a fifth of the life, rounded, and never under a year", () => {
    expect(estimateSpreadYears(2)).toBe(1); // 0.4
    expect(estimateSpreadYears(7)).toBe(1); // 1.4
    expect(estimateSpreadYears(8)).toBe(2); // 1.6
    expect(estimateSpreadYears(20)).toBe(4);
    expect(estimateSpreadYears(50)).toBe(10);
  });
});

describe("outflowByYear", () => {
  it("is ten bars from this year, empty years at zero", () => {
    const years = outflowByYear(replacements([], THIS_YEAR), THIS_YEAR);

    expect(years.map((y) => y.year)).toEqual([
      2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035,
    ]);
    expect(years.every((y) => y.totalCents === 0)).toBe(true);
  });

  it("keeps audited and estimated cost apart, summing to the bar", () => {
    const years = outflowByYear(
      replacements(
        [
          item({ replacementCostCents: 480_000 }),
          item({ replacementCostCents: 130_001, confidence: "estimated" }),
          item({ installYear: 1999, replacementCostCents: 50_000 }),
        ],
        THIS_YEAR,
      ),
      THIS_YEAR,
    );

    expect(years[0]).toMatchObject({
      totalCents: 660_001,
      auditedCents: 530_000,
      estimatedCents: 130_001,
    });
  });

  it("counts an estimated item's recurrence as estimated", () => {
    const years = outflowByYear(
      replacements(
        [
          item({
            expectedLifeYears: 5,
            installYear: 2021,
            confidence: "estimated",
          }),
        ],
        THIS_YEAR,
      ),
      THIS_YEAR,
    );

    expect(years[5]).toMatchObject({ year: 2031, estimatedCents: 100_000 });
  });

  it("lists a year's replacements by cost, largest first, then by label", () => {
    const years = outflowByYear(
      replacements(
        [
          item({ label: "Washer", replacementCostCents: 90_000 }),
          item({ label: "Roof", replacementCostCents: 1_050_000 }),
          item({ label: "Dryer", replacementCostCents: 90_000 }),
        ],
        THIS_YEAR,
      ),
      THIS_YEAR,
    );

    expect(years[0]?.replacements.map((r) => r.item.label)).toEqual([
      "Roof",
      "Dryer",
      "Washer",
    ]);
  });

  it("refuses a cost that is not whole cents", () => {
    expect(() =>
      outflowByYear(
        replacements([item({ replacementCostCents: 10.5 })], THIS_YEAR),
        THIS_YEAR,
      ),
    ).toThrow(RangeError);
  });
});

describe("level funding", () => {
  function fundingFor(costCents: number) {
    const years = outflowByYear(
      replacements([item({ replacementCostCents: costCents })], THIS_YEAR),
      THIS_YEAR,
    );
    return {
      total: tenYearTotalCents(years),
      monthly: levelFundingPerMonthCents(years),
    };
  }

  it("is the ten-year total over 120 months", () => {
    expect(fundingFor(1_200_000)).toEqual({
      total: 1_200_000,
      monthly: 10_000,
    });
  });

  it("rounds up to the cent, so it never falls short of the total", () => {
    expect(fundingFor(1_200_001).monthly).toBe(10_001);
    expect(fundingFor(1).monthly).toBe(1);
  });

  it("is zero with nothing due", () => {
    expect(fundingFor(0).monthly).toBe(0);
  });
});
