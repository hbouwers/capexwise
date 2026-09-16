/**
 * The reserve projection and the monthly need. The timing rules (#124) are
 * where a plausible implementation is quietly wrong — a December start that
 * counts a contribution before January's payment, a need a cent too low — so
 * each is pinned from both sides, and the need is checked against the
 * projection it claims to fix.
 */
import { describe, expect, it } from "vitest";

import { FORECAST_YEARS, type YearOutflow } from "@/lib/forecast/outflow";
import {
  contributionsBefore,
  projectReserve,
  reserveNeededPerMonthCents,
} from "@/lib/forecast/reserve";

const THIS_YEAR = 2026;

/** Ten bars from this year, with the given totals by year. */
function bars(totals: Record<number, number> = {}): YearOutflow[] {
  return Array.from({ length: FORECAST_YEARS }, (_, index) => {
    const year = THIS_YEAR + index;
    const totalCents = totals[year] ?? 0;
    return {
      year,
      totalCents,
      auditedCents: totalCents,
      estimatedCents: 0,
      replacements: [],
    };
  });
}

describe("contributionsBefore", () => {
  it("counts none before this year's payment", () => {
    expect(contributionsBefore(THIS_YEAR, THIS_YEAR, 1)).toBe(0);
    expect(contributionsBefore(THIS_YEAR, THIS_YEAR, 12)).toBe(0);
  });

  it("counts the rest of this year's months, the first one next month", () => {
    expect(contributionsBefore(2027, THIS_YEAR, 1)).toBe(11);
    expect(contributionsBefore(2027, THIS_YEAR, 9)).toBe(3);
  });

  it("counts none before next January from December", () => {
    expect(contributionsBefore(2027, THIS_YEAR, 12)).toBe(0);
    expect(contributionsBefore(2028, THIS_YEAR, 12)).toBe(12);
  });

  it("adds twelve for each whole year between", () => {
    expect(contributionsBefore(2035, THIS_YEAR, 9)).toBe(3 + 12 * 8);
  });

  it("refuses a month that is not one", () => {
    expect(() => contributionsBefore(2027, THIS_YEAR, 0)).toThrow(RangeError);
    expect(() => contributionsBefore(2027, THIS_YEAR, 13)).toThrow(RangeError);
  });
});

describe("projectReserve", () => {
  // $10,000 saved, $500 a month, from September. $3,000 due this year and a
  // $20,000 roof in 2028.
  const years = bars({ 2026: 300_000, 2028: 2_000_000 });
  const reserve = { balanceCents: 1_000_000, monthlyContributionCents: 50_000 };

  it("pays this year's replacements out of the balance before anything is added", () => {
    const projection = projectReserve(years, reserve, 9);

    expect(projection.years[0]).toEqual({
      year: 2026,
      contributionsCents: 0,
      replacementsCents: 300_000,
      balanceCents: 700_000,
      short: false,
    });
  });

  it("pays a year's replacements in January, before that January's contribution", () => {
    const projection = projectReserve(years, reserve, 9);

    // October 2026 through December 2027 is fifteen contributions.
    expect(projection.years[2]).toEqual({
      year: 2028,
      contributionsCents: 750_000,
      replacementsCents: 2_300_000,
      balanceCents: -550_000,
      short: true,
    });
    expect(projection.shortYears).toEqual([2028]);
  });

  it("finds the low point, and its four lines add up", () => {
    const { balanceCents, lowest } = projectReserve(years, reserve, 9);

    expect(lowest.year).toBe(2028);
    expect(
      balanceCents + lowest.contributionsCents - lowest.replacementsCents,
    ).toBe(lowest.balanceCents);
  });

  it("marks a year short from December that January would have covered", () => {
    const nextYear = bars({ 2027: 500_000 });
    const small = { balanceCents: 0, monthlyContributionCents: 50_000 };

    expect(projectReserve(nextYear, small, 1).shortYears).toEqual([]);
    expect(projectReserve(nextYear, small, 12).shortYears).toEqual([2027]);
  });

  it("with a contribution of zero, only ever spends", () => {
    const projection = projectReserve(
      bars({ 2027: 400_000, 2030: 400_000 }),
      { balanceCents: 600_000, monthlyContributionCents: 0 },
      9,
    );

    expect(projection.years.map((y) => y.balanceCents)).toEqual([
      600_000, 200_000, 200_000, 200_000, -200_000, -200_000, -200_000,
      -200_000, -200_000, -200_000,
    ]);
    expect(projection.lowest.year).toBe(2030);
    expect(projection.shortYears).toEqual([2030, 2031, 2032, 2033, 2034, 2035]);
  });

  it("takes the earliest year when the low point ties", () => {
    const projection = projectReserve(
      bars(),
      { balanceCents: 250_000, monthlyContributionCents: 0 },
      9,
    );

    expect(projection.lowest).toMatchObject({
      year: 2026,
      balanceCents: 250_000,
    });
  });

  it("refuses a negative or fractional reserve", () => {
    expect(() =>
      projectReserve(
        years,
        { balanceCents: -1, monthlyContributionCents: 0 },
        9,
      ),
    ).toThrow(RangeError);
    expect(() =>
      projectReserve(
        years,
        { balanceCents: 0, monthlyContributionCents: 0.5 },
        9,
      ),
    ).toThrow(RangeError);
  });
});

describe("reserveNeededPerMonthCents", () => {
  /** Whether the projection runs short in a year a contribution reaches. */
  function shortWith(
    years: YearOutflow[],
    balanceCents: number,
    monthly: number,
    thisMonth: number,
  ): boolean {
    return projectReserve(
      years,
      { balanceCents, monthlyContributionCents: monthly },
      thisMonth,
    ).years.some(
      (y) => y.short && contributionsBefore(y.year, THIS_YEAR, thisMonth) > 0,
    );
  }

  it("is the smallest contribution that never runs short, to the cent", () => {
    const years = bars({ 2026: 300_000, 2028: 2_000_000 });
    const needed = reserveNeededPerMonthCents(years, 1_000_000, 9);

    // ($23,000 − $10,000) ÷ 15 months = $866.666…, up to $866.67.
    expect(needed).toBe(86_667);
    expect(shortWith(years, 1_000_000, needed, 9)).toBe(false);
    expect(shortWith(years, 1_000_000, needed - 1, 9)).toBe(true);
  });

  it("takes the tightest year, not the last or the largest", () => {
    // 2027 asks $6,000 ÷ 11 = $545.46; 2035 asks $12,000 ÷ 107 = $112.15.
    const years = bars({ 2027: 600_000, 2035: 600_000 });
    const needed = reserveNeededPerMonthCents(years, 0, 1);

    expect(needed).toBe(54_546);
    expect(shortWith(years, 0, needed, 1)).toBe(false);
    expect(shortWith(years, 0, needed - 1, 1)).toBe(true);
  });

  it("is zero when the balance covers everything", () => {
    const years = bars({ 2026: 100_000, 2031: 400_000 });

    expect(reserveNeededPerMonthCents(years, 500_000, 9)).toBe(0);
    expect(
      projectReserve(
        years,
        { balanceCents: 500_000, monthlyContributionCents: 0 },
        9,
      ).shortYears,
    ).toEqual([]);
  });

  it("is zero with nothing to replace", () => {
    expect(reserveNeededPerMonthCents(bars(), 0, 9)).toBe(0);
  });

  it("pays back a shortfall no contribution can reach this year", () => {
    // $5,000 due now against $1,000: short this year whatever is saved, and
    // the need is what closes the gap by next January — 3 months from
    // September.
    const years = bars({ 2026: 500_000 });
    const needed = reserveNeededPerMonthCents(years, 100_000, 9);

    expect(needed).toBe(133_334);
    const projection = projectReserve(
      years,
      { balanceCents: 100_000, monthlyContributionCents: needed },
      9,
    );
    expect(projection.shortYears).toEqual([2026]);
    expect(projection.years[1]?.balanceCents).toBeGreaterThanOrEqual(0);
  });

  it("from December, asks next year's shortfall of the year after", () => {
    const years = bars({ 2027: 1_200_000 });

    expect(reserveNeededPerMonthCents(years, 0, 12)).toBe(100_000); // ÷ 12
    expect(reserveNeededPerMonthCents(years, 0, 1)).toBe(109_091); // ÷ 11
  });
});
