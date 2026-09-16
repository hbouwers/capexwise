/**
 * The forecast's URL. The deferral parser is the one that matters: an entry
 * it keeps is a chart the page shows as changed, so an entry that changes
 * nothing has to be dropped rather than announced.
 */
import { describe, expect, it } from "vitest";

import {
  forecastHref,
  forecastToday,
  formatDeferrals,
  parseDeferrals,
  parseForecastYear,
} from "@/lib/forecast/params";

const ITEMS = new Set(["roof", "furnace"]);

describe("parseForecastYear", () => {
  it("takes any of the ten years", () => {
    expect(parseForecastYear("2026", 2026)).toBe(2026);
    expect(parseForecastYear("2035", 2026)).toBe(2035);
  });

  it("falls back to this year outside them, or for anything that is not a year", () => {
    expect(parseForecastYear(undefined, 2026)).toBe(2026);
    expect(parseForecastYear("2025", 2026)).toBe(2026);
    expect(parseForecastYear("2036", 2026)).toBe(2026);
    expect(parseForecastYear("2028.5", 2026)).toBe(2026);
    expect(parseForecastYear(["2028", "2029"], 2026)).toBe(2026);
  });
});

describe("parseDeferrals", () => {
  it("reads each item and its years", () => {
    expect(parseDeferrals("roof:2,furnace:1", ITEMS)).toEqual({
      deferrals: new Map([
        ["roof", 2],
        ["furnace", 1],
      ]),
      dropped: false,
    });
  });

  it("is no deferral and nothing dropped without the param", () => {
    expect(parseDeferrals(undefined, ITEMS)).toEqual({
      deferrals: new Map(),
      dropped: false,
    });
  });

  it("drops an item that is not forecast, and keeps the rest", () => {
    expect(parseDeferrals("gone:1,roof:3", ITEMS)).toEqual({
      deferrals: new Map([["roof", 3]]),
      dropped: true,
    });
  });

  it("drops a deferral of anything but one, two or three years", () => {
    for (const raw of ["roof:0", "roof:4", "roof:-1", "roof:1.5", "roof"]) {
      expect(parseDeferrals(raw, ITEMS)).toEqual({
        deferrals: new Map(),
        dropped: true,
      });
    }
  });

  it("keeps the first of two entries for one item", () => {
    expect(parseDeferrals("roof:1,roof:3", ITEMS)).toEqual({
      deferrals: new Map([["roof", 1]]),
      dropped: true,
    });
  });

  it("drops a repeated param whole", () => {
    expect(parseDeferrals(["roof:1", "furnace:2"], ITEMS)).toEqual({
      deferrals: new Map(),
      dropped: true,
    });
  });

  it("round-trips through formatDeferrals", () => {
    const deferrals = new Map([
      ["roof", 2],
      ["furnace", 1],
    ]);

    expect(
      parseDeferrals(formatDeferrals(deferrals) ?? undefined, ITEMS).deferrals,
    ).toEqual(deferrals);
    expect(formatDeferrals(new Map())).toBeNull();
  });
});

describe("forecastHref", () => {
  it("leaves out what is the default", () => {
    expect(forecastHref({ year: 2026, thisYear: 2026 })).toBe("/forecast");
  });

  it("carries the building, the year and the deferrals", () => {
    expect(
      forecastHref({
        building: "b1",
        year: 2028,
        thisYear: 2026,
        deferrals: new Map([["roof", 2]]),
      }),
    ).toBe("/forecast?building=b1&year=2028&defer=roof%3A2");
  });
});

describe("forecastToday", () => {
  // 03:30 UTC on January 1: still December 31 in Indianapolis.
  const newYear = new Date("2027-01-01T03:30:00Z");

  it("is the latest of the buildings' todays", () => {
    expect(
      forecastToday(["America/Indiana/Indianapolis", "Europe/London"], newYear),
    ).toBe("2027-01-01");
    expect(forecastToday(["America/Indiana/Indianapolis"], newYear)).toBe(
      "2026-12-31",
    );
  });

  it("is UTC's with no building", () => {
    expect(forecastToday([], newYear)).toBe("2027-01-01");
  });
});
