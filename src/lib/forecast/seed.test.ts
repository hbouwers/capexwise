/**
 * The install-year seed. Its edges are the two bounds — the building's age,
 * and this year for a building not finished yet — and the rounding, which
 * decides the year for most of the catalogue's lives.
 */
import { describe, expect, it } from "vitest";

import { seedInstallYear } from "@/lib/forecast/seed";

describe("seedInstallYear", () => {
  it("puts the item 60% of the way through its life", () => {
    // 20 × 0.6 = 12, 15 × 0.6 = 9.
    expect(seedInstallYear(20, 1924, 2026)).toBe(2014);
    expect(seedInstallYear(15, 1924, 2026)).toBe(2017);
  });

  it("rounds to the nearest year", () => {
    // 13 × 0.6 = 7.8 up to 8, and 12 × 0.6 = 7.2 down to 7.
    expect(seedInstallYear(13, null, 2026)).toBe(2018);
    expect(seedInstallYear(12, null, 2026)).toBe(2019);
    // 1 × 0.6 rounds to a whole year; 2 × 0.6 = 1.2 rounds to one.
    expect(seedInstallYear(1, null, 2026)).toBe(2025);
    expect(seedInstallYear(2, null, 2026)).toBe(2025);
  });

  it("never goes back before the building", () => {
    // A 2019 building with a 50-year roof: 30 years back is 1996, before it
    // stood.
    expect(seedInstallYear(50, 2019, 2026)).toBe(2019);
  });

  it("takes the building's year when the two agree", () => {
    expect(seedInstallYear(20, 2014, 2026)).toBe(2014);
  });

  it("goes back as far as the life says when the build year is not known", () => {
    expect(seedInstallYear(50, null, 2026)).toBe(1996);
  });

  it("never seeds a year still to come", () => {
    // A building entered before it is finished: the build year is next year,
    // and an estimate of when something went in cannot be after today.
    expect(seedInstallYear(20, 2027, 2026)).toBe(2026);
  });

  it("puts a brand-new building's items in this year", () => {
    expect(seedInstallYear(15, 2026, 2026)).toBe(2026);
  });

  it("refuses a life that is not a whole number of years above zero", () => {
    expect(() => seedInstallYear(0, null, 2026)).toThrow(RangeError);
    expect(() => seedInstallYear(-5, null, 2026)).toThrow(RangeError);
    expect(() => seedInstallYear(7.5, null, 2026)).toThrow(RangeError);
  });
});
