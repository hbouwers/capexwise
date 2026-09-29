/**
 * The two recovery schedules. What goes wrong silently here is the first and
 * the last year — the convention decides both — and a schedule whose years do
 * not add back up to its basis. The percentages are IRS Publication 946's
 * tables A-6 (27.5 years, mid-month) and A-8's straight-line half-year column.
 */
import { describe, expect, it } from "vitest";

import {
  depreciationIn,
  divideRounded,
  halfMonthsInServiceIn,
  halfMonthsInServiceThrough,
  recoveredThrough,
} from "@/lib/tax/depreciation";

/** $275,000: $10,000 a full year over 27.5, so the table reads in dollars. */
const BUILDING = 27_500_000;

function schedule(
  basis: number,
  recovery: "residential" | "five-year",
  placed: { year: number; month: number },
): number[] {
  const years: number[] = [];
  for (let year = placed.year; year < placed.year + 40; year++) {
    const amount = depreciationIn(basis, recovery, placed, year);
    if (amount === 0 && year > placed.year) break;
    years.push(amount);
  }
  return years;
}

describe("residential, 27.5 years mid-month", () => {
  it("gives January 11.5 months and December half of one", () => {
    expect(
      halfMonthsInServiceIn("residential", { year: 2026, month: 1 }, 2026),
    ).toBe(23);
    expect(
      halfMonthsInServiceIn("residential", { year: 2026, month: 12 }, 2026),
    ).toBe(1);

    // Table A-6: 3.485% and 0.152%.
    expect(
      depreciationIn(BUILDING, "residential", { year: 2026, month: 1 }, 2026),
    ).toBe(958_333);
    expect(
      depreciationIn(BUILDING, "residential", { year: 2026, month: 12 }, 2026),
    ).toBe(41_667);
  });

  it("depreciates a full year at 1/27.5 of the basis", () => {
    const placed = { year: 2020, month: 6 };

    expect(halfMonthsInServiceIn("residential", placed, 2026)).toBe(24);
    expect(depreciationIn(BUILDING, "residential", placed, 2026)).toBe(
      1_000_000,
    );
  });

  it("spreads a January building over 28 years, the last one 6.5 months", () => {
    const years = schedule(BUILDING, "residential", { year: 2000, month: 1 });

    expect(years).toHaveLength(28);
    expect(years.at(-1)).toBe(541_667); // 1.970%
  });

  it("spreads a building placed after January over 29 years", () => {
    const years = schedule(BUILDING, "residential", { year: 2000, month: 7 });

    expect(years).toHaveLength(29);
    expect(years[0]).toBe(458_333); // 1.667%, 5.5 months
    expect(years.at(-1)).toBe(41_667); // the half-month that is left
  });

  it("sums every schedule to its basis exactly, whatever the month", () => {
    // An awkward basis, so each year's figure has a remainder to round.
    const basis = 31_415_927;
    for (let month = 1; month <= 12; month++) {
      const years = schedule(basis, "residential", { year: 2000, month });
      expect(years.reduce((a, b) => a + b, 0)).toBe(basis);
    }
  });

  it("depreciates nothing before it is in service or after it is recovered", () => {
    const placed = { year: 2026, month: 3 };

    expect(depreciationIn(BUILDING, "residential", placed, 2025)).toBe(0);
    expect(
      depreciationIn(BUILDING, "residential", { year: 1990, month: 1 }, 2026),
    ).toBe(0);
    expect(
      recoveredThrough(BUILDING, "residential", { year: 1990, month: 1 }, 2026),
    ).toBe(BUILDING);
  });
});

describe("five-year, half-year convention", () => {
  it("takes 10%, then 20% four times, then 10% (Table A-8, straight line)", () => {
    const dryer = 90_000;

    expect(schedule(dryer, "five-year", { year: 2026, month: 3 })).toEqual([
      9_000, 18_000, 18_000, 18_000, 18_000, 9_000,
    ]);
  });

  it("gives the same first year whichever month it went in", () => {
    const january = depreciationIn(
      90_000,
      "five-year",
      { year: 2026, month: 1 },
      2026,
    );
    const december = depreciationIn(
      90_000,
      "five-year",
      { year: 2026, month: 12 },
      2026,
    );

    expect(january).toBe(december);
    expect(
      halfMonthsInServiceThrough("five-year", { year: 2026, month: 12 }, 2026),
    ).toBe(12);
  });

  it("sums to its basis exactly", () => {
    const years = schedule(123_457, "five-year", { year: 2026, month: 5 });

    expect(years.reduce((a, b) => a + b, 0)).toBe(123_457);
  });
});

describe("a refund on capitalized work", () => {
  it("recovers as the mirror image of a purchase of its size", () => {
    const placed = { year: 2026, month: 4 };

    expect(depreciationIn(-1_234_567, "residential", placed, 2027)).toBe(
      -depreciationIn(1_234_567, "residential", placed, 2027),
    );
  });
});

describe("divideRounded", () => {
  it("rounds halves away from zero, on the magnitude", () => {
    expect(divideRounded(5n, 2n)).toBe(3);
    expect(divideRounded(-5n, 2n)).toBe(-3);
    expect(divideRounded(4n, 3n)).toBe(1);
    expect(divideRounded(-1n, 3n)).toBe(0);
  });
});

describe("guards", () => {
  it("refuses a month outside the year and a fraction of a cent", () => {
    expect(() =>
      depreciationIn(100, "residential", { year: 2026, month: 13 }, 2026),
    ).toThrow(RangeError);
    expect(() =>
      depreciationIn(100.5, "residential", { year: 2026, month: 1 }, 2026),
    ).toThrow(RangeError);
  });
});
