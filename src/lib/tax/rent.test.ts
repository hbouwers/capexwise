/**
 * Gross rent is the first line of the statement and the base of the
 * effective rate, so the boundary between received and expected is held here:
 * the current month, an earlier month nobody marked, and a vacancy.
 */
import { describe, expect, it } from "vitest";

import { yearRent, type YearRentPeriod } from "@/lib/tax/rent";

function period(
  periodMonth: string,
  overrides: Partial<YearRentPeriod> = {},
): YearRentPeriod {
  return {
    periodMonth,
    amountExpectedCents: 150_000,
    amountReceivedCents: 150_000,
    vacant: false,
    ...overrides,
  };
}

describe("yearRent", () => {
  it("counts what was received to date and expects the rest of the year at today's rent", () => {
    expect(
      yearRent({
        year: 2026,
        currentMonth: "2026-09-01",
        periods: [
          period("2026-07-01"),
          period("2026-08-01"),
          period("2026-09-01", { amountReceivedCents: null }),
        ],
        occupiedRentCents: [160_000, 90_000],
      }),
    ).toEqual({
      receivedCents: 300_000,
      // September's snapshot, then October to December at $2,500 a month.
      expectedCents: 150_000 + 3 * 250_000,
      unmarkedPeriods: 0,
    });
  });

  it("takes the current month as received once it is marked, whatever was expected", () => {
    const rent = yearRent({
      year: 2026,
      currentMonth: "2026-12-01",
      periods: [period("2026-12-01", { amountReceivedCents: 100_000 })],
      occupiedRentCents: [150_000],
    });

    expect(rent).toEqual({
      receivedCents: 100_000,
      expectedCents: 0,
      unmarkedPeriods: 0,
    });
  });

  it("counts an earlier month nobody marked as nothing, and says how many", () => {
    expect(
      yearRent({
        year: 2026,
        currentMonth: "2026-09-01",
        periods: [
          period("2026-07-01", { amountReceivedCents: null }),
          period("2026-08-01", { amountReceivedCents: null }),
        ],
        occupiedRentCents: [],
      }),
    ).toEqual({ receivedCents: 0, expectedCents: 0, unmarkedPeriods: 2 });
  });

  it("expects nothing of a vacant month, and does not call it unmarked", () => {
    expect(
      yearRent({
        year: 2026,
        currentMonth: "2026-09-01",
        periods: [
          period("2026-08-01", { vacant: true, amountReceivedCents: null }),
          period("2026-09-01", { vacant: true, amountReceivedCents: null }),
        ],
        occupiedRentCents: [],
      }),
    ).toEqual({ receivedCents: 0, expectedCents: 0, unmarkedPeriods: 0 });
  });

  it("does not count a month opened early twice", () => {
    expect(
      yearRent({
        year: 2026,
        currentMonth: "2026-11-01",
        periods: [
          period("2026-11-01"),
          period("2026-12-01", {
            amountExpectedCents: 140_000,
            amountReceivedCents: null,
          }),
        ],
        occupiedRentCents: [150_000],
      }).expectedCents,
    ).toBe(140_000);
  });

  it("ignores periods from other years", () => {
    expect(
      yearRent({
        year: 2026,
        currentMonth: "2026-12-01",
        periods: [period("2025-12-01"), period("2027-01-01")],
        occupiedRentCents: [],
      }),
    ).toEqual({ receivedCents: 0, expectedCents: 0, unmarkedPeriods: 0 });
  });

  it("expects nothing more of a year already over", () => {
    expect(
      yearRent({
        year: 2025,
        currentMonth: "2026-02-01",
        periods: [period("2025-12-01")],
        occupiedRentCents: [150_000],
      }),
    ).toEqual({ receivedCents: 150_000, expectedCents: 0, unmarkedPeriods: 0 });
  });
});
