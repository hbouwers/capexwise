/**
 * The forecast page's arithmetic end to end: that today decides the year and
 * the month, that a missing reserve falls back to level funding, and that a
 * deferral moves the chart, the figures and the reserve together.
 */
import { describe, expect, it } from "vitest";

import { type ForecastItem } from "@/lib/forecast/outflow";
import { forecast } from "@/lib/forecast/plan";

const roof: ForecastItem = {
  id: "roof",
  label: "Roof",
  installYear: 2008,
  expectedLifeYears: 20,
  replacementCostCents: 2_000_000,
  confidence: "audited",
  status: "active",
  plannedYear: null,
};

const heater: ForecastItem = {
  id: "heater",
  label: "Water heater",
  installYear: 2015,
  expectedLifeYears: 10,
  replacementCostCents: 300_000,
  confidence: "estimated",
  status: "active",
  plannedYear: null,
};

const reserve = { balanceCents: 1_000_000, monthlyContributionCents: 50_000 };

describe("forecast", () => {
  it("reads this year and this month from today", () => {
    const september = forecast({
      items: [roof, heater],
      today: "2026-09-16",
      reserve,
    });

    expect(september.thisYear).toBe(2026);
    expect(september.years[0]?.year).toBe(2026);
    // The heater was due 2025, so it is this year's; the roof lands in 2028.
    expect(september.years[0]?.totalCents).toBe(300_000);
    expect(september.years[2]?.totalCents).toBe(2_000_000);
    // The heater comes round again in 2036, past the ten years.
    expect(september.totalCents).toBe(2_300_000);
    expect(september.reserve?.neededPerMonthCents).toBe(86_667);

    const january = forecast({
      items: [roof, heater],
      today: "2026-01-02",
      reserve,
    });
    // Twenty-three contributions before January 2028 rather than fifteen.
    expect(january.reserve?.neededPerMonthCents).toBe(56_522);
  });

  it("leaves the reserve out until one is entered, and still level-funds", () => {
    const result = forecast({
      items: [roof, heater],
      today: "2026-09-16",
      reserve: null,
    });

    expect(result.reserve).toBeNull();
    expect(result.levelFundingPerMonthCents).toBe(19_167); // $23,000 ÷ 120
  });

  it("moves the chart, the figures and the reserve together when deferred", () => {
    const base = forecast({
      items: [roof, heater],
      today: "2026-09-16",
      reserve,
    });
    const deferred = forecast({
      items: [roof, heater],
      today: "2026-09-16",
      reserve,
      deferrals: new Map([["roof", 2]]),
    });

    expect(base.years[2]?.totalCents).toBe(2_000_000);
    expect(deferred.years[2]?.totalCents).toBe(0);
    expect(deferred.years[4]?.totalCents).toBe(2_000_000);

    expect(base.reserve?.projection.lowest.year).toBe(2028);
    expect(base.reserve?.projection.shortYears).toEqual([2028]);
    expect(deferred.reserve?.projection.shortYears).toEqual([]);
    expect(deferred.reserve?.projection.lowest).toMatchObject({
      year: 2030,
      balanceCents: 650_000,
    });

    // ($23,000 − $10,000) over 39 months rather than 15.
    expect(deferred.reserve?.neededPerMonthCents).toBe(33_334);
    expect(deferred.totalCents).toBe(base.totalCents);
  });
});
