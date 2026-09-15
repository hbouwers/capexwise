/**
 * The rent roll's rules. The one with a real way to be wrong is `paidOn` —
 * back-filling January in September must not record January's rent as having
 * arrived in September — and the one with the most edges is the month range,
 * which is what keeps a period from opening in a month that has not happened.
 */
import { describe, expect, it } from "vitest";

import {
  chooseMonth,
  monthParam,
  paidOn,
  rentRollMonths,
  rentState,
  rentTotals,
  unmarkedLine,
} from "@/lib/rent";

describe("rentRollMonths", () => {
  it("reaches back two years when the acquisition is not entered", () => {
    expect(rentRollMonths("2026-09-14", null)).toEqual({
      earliest: "2024-09-01",
      current: "2026-09-01",
    });
  });

  it("reaches back to the month the building was acquired", () => {
    expect(rentRollMonths("2026-09-14", "2019-06-17")).toEqual({
      earliest: "2019-06-01",
      current: "2026-09-01",
    });
    expect(rentRollMonths("2026-09-14", "2026-03-02").earliest).toBe(
      "2026-03-01",
    );
  });

  it("reaches no further than now for an acquisition still to come", () => {
    expect(rentRollMonths("2026-09-14", "2026-11-01")).toEqual({
      earliest: "2026-09-01",
      current: "2026-09-01",
    });
  });

  it("starts the current month on its first day, whatever today is", () => {
    expect(rentRollMonths("2026-09-01", null).current).toBe("2026-09-01");
    expect(rentRollMonths("2026-09-30", null).current).toBe("2026-09-01");
  });
});

describe("chooseMonth", () => {
  const range = { earliest: "2024-09-01", current: "2026-09-01" };

  it("reads the month a param names", () => {
    expect(chooseMonth("2026-03", range)).toBe("2026-03-01");
    expect(chooseMonth("2024-09", range)).toBe("2024-09-01");
  });

  it("is the current month when nothing is asked for", () => {
    expect(chooseMonth(undefined, range)).toBe("2026-09-01");
  });

  it.each([
    ["a day", "2026-03-14"],
    ["a month that is not one", "2026-13"],
    ["words", "march"],
    ["two params", ["2026-03", "2026-04"]],
  ])("is the current month for %s", (_, requested) => {
    expect(chooseMonth(requested, range)).toBe("2026-09-01");
  });

  it("never reaches past the current month", () => {
    // A future month viewed today would snapshot today's rent into it.
    expect(chooseMonth("2026-10", range)).toBe("2026-09-01");
    expect(chooseMonth("2031-01", range)).toBe("2026-09-01");
  });

  it("lands an old bookmark on the earliest month", () => {
    expect(chooseMonth("2020-01", range)).toBe("2024-09-01");
  });
});

describe("monthParam", () => {
  it("is the month without its day", () => {
    expect(monthParam("2026-09-01")).toBe("2026-09");
  });
});

describe("paidOn", () => {
  it("is today for the current month", () => {
    expect(paidOn("2026-09-01", "2026-09-14")).toBe("2026-09-14");
    expect(paidOn("2026-09-01", "2026-09-01")).toBe("2026-09-01");
  });

  it("is the period's first day for a past month", () => {
    // Back-filling January in September records January.
    expect(paidOn("2026-01-01", "2026-09-14")).toBe("2026-01-01");
    // The month just gone as well — the rule is the month, not a window.
    expect(paidOn("2026-08-01", "2026-09-01")).toBe("2026-08-01");
  });

  it("is the period's first day across a year end", () => {
    expect(paidOn("2025-12-01", "2026-01-02")).toBe("2025-12-01");
  });
});

describe("rentState", () => {
  const period = { amountExpectedCents: 230_000, vacant: false };

  it("is not marked until somebody says it arrived", () => {
    expect(rentState({ ...period, amountReceivedCents: null })).toBe(
      "not-marked",
    );
  });

  it("is paid at exactly the expected amount", () => {
    expect(rentState({ ...period, amountReceivedCents: 230_000 })).toBe("paid");
  });

  it("is partial a cent short, and over a cent above", () => {
    expect(rentState({ ...period, amountReceivedCents: 229_999 })).toBe(
      "partial",
    );
    expect(rentState({ ...period, amountReceivedCents: 230_001 })).toBe("over");
  });

  it("is vacant whatever the snapshot expected", () => {
    expect(
      rentState({ ...period, vacant: true, amountReceivedCents: null }),
    ).toBe("vacant");
  });
});

describe("rentTotals", () => {
  it("adds expected and received over the month", () => {
    expect(
      rentTotals([
        {
          amountExpectedCents: 230_000,
          amountReceivedCents: 230_000,
          vacant: false,
        },
        {
          amountExpectedCents: 195_000,
          amountReceivedCents: 120_000,
          vacant: false,
        },
        {
          amountExpectedCents: 150_000,
          amountReceivedCents: null,
          vacant: false,
        },
      ]),
    ).toEqual({ expectedCents: 575_000, receivedCents: 350_000 });
  });

  it("leaves a vacant month out of both halves", () => {
    // #97: its snapshot stays on the row, and counts for nothing.
    expect(
      rentTotals([
        {
          amountExpectedCents: 230_000,
          amountReceivedCents: 230_000,
          vacant: false,
        },
        {
          amountExpectedCents: 195_000,
          amountReceivedCents: null,
          vacant: true,
        },
      ]),
    ).toEqual({ expectedCents: 230_000, receivedCents: 230_000 });
  });

  it("is zero on both sides with nothing to add", () => {
    expect(rentTotals([])).toEqual({ expectedCents: 0, receivedCents: 0 });
  });
});

describe("unmarkedLine", () => {
  it("names the month, and the year only when it is not this one", () => {
    expect(unmarkedLine("2026-08-01", 1, "2026-09-01")).toBe(
      "August has 1 unit not marked",
    );
    expect(unmarkedLine("2025-12-01", 2, "2026-01-01")).toBe(
      "December 2025 has 2 units not marked",
    );
  });
});
