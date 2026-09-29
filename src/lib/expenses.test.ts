/**
 * The expenses page's rules. The ones with a real way to be wrong are the
 * sign — `amount_cents` is the one signed money column in the schema, and a
 * refund counted as spend doubles the error — and the period arithmetic the
 * Cash flow tile's year to date rests on.
 */
import { describe, expect, it } from "vitest";

import {
  asksClassification,
  categoryForTrade,
  choosePeriod,
  directionOf,
  expenseMonths,
  expensesHref,
  periodBounds,
  periodParam,
  signedAmount,
  spendTotals,
  yearThroughPeriod,
  yearToDateLabel,
} from "@/lib/expenses";

describe("expenseMonths", () => {
  it("reaches back two years when nothing older is recorded", () => {
    expect(expenseMonths("2026-09-29", null)).toEqual({
      earliest: "2024-09-01",
      current: "2026-09-01",
    });
    expect(expenseMonths("2026-09-29", "2026-02-14").earliest).toBe(
      "2024-09-01",
    );
  });

  it("reaches back to the oldest expense recorded before that", () => {
    expect(expenseMonths("2026-09-29", "2021-03-17").earliest).toBe(
      "2021-03-01",
    );
  });
});

describe("choosePeriod", () => {
  const range = { earliest: "2024-09-01", current: "2026-09-01" };

  it("reads this year from `year`, and is the current year's", () => {
    expect(choosePeriod("year", range)).toEqual({ kind: "year", year: 2026 });
  });

  it("reads a month inside the range, and the current month otherwise", () => {
    expect(choosePeriod("2026-03", range)).toEqual({
      kind: "month",
      month: "2026-03-01",
    });
    expect(choosePeriod("2027-01", range)).toEqual({
      kind: "month",
      month: "2026-09-01",
    });
    expect(choosePeriod(["year"], range)).toEqual({
      kind: "month",
      month: "2026-09-01",
    });
  });
});

describe("periodBounds and yearThroughPeriod", () => {
  it("ends a month on the first of the next, across a year end", () => {
    expect(periodBounds({ kind: "month", month: "2025-12-01" })).toEqual({
      from: "2025-12-01",
      until: "2026-01-01",
    });
  });

  it("covers a year from January to the January after", () => {
    expect(periodBounds({ kind: "year", year: 2026 })).toEqual({
      from: "2026-01-01",
      until: "2027-01-01",
    });
  });

  it("runs the year to date through the month looked at, not through today", () => {
    expect(yearThroughPeriod({ kind: "month", month: "2026-03-01" })).toEqual({
      from: "2026-01-01",
      until: "2026-04-01",
    });
  });
});

describe("periodParam and yearToDateLabel", () => {
  const range = { earliest: "2024-09-01", current: "2026-09-01" };

  it("leaves the current month out of the URL", () => {
    expect(periodParam({ kind: "month", month: "2026-09-01" }, range)).toBe(
      null,
    );
    expect(periodParam({ kind: "month", month: "2026-03-01" }, range)).toBe(
      "2026-03",
    );
    expect(periodParam({ kind: "year", year: 2026 }, range)).toBe("year");
  });

  it("names the months the year to date covers", () => {
    expect(yearToDateLabel({ kind: "month", month: "2026-03-01" }, range)).toBe(
      "Jan–Mar",
    );
    expect(yearToDateLabel({ kind: "month", month: "2026-01-01" }, range)).toBe(
      "Jan",
    );
    expect(yearToDateLabel({ kind: "year", year: 2026 }, range)).toBe(
      "Jan–Sep",
    );
  });
});

describe("the sign", () => {
  it("stores money out as negative and a refund as positive", () => {
    expect(signedAmount(18_000, "out")).toBe(-18_000);
    expect(signedAmount(4_000, "refund")).toBe(4_000);
    expect(directionOf(-18_000)).toBe("out");
    expect(directionOf(4_000)).toBe("refund");
  });

  it("counts a refund against the spend rather than as more of it", () => {
    expect(
      spendTotals([
        { amountCents: -18_000 },
        { amountCents: -2_550 },
        { amountCents: 4_000 },
      ]),
    ).toEqual({ spentCents: 16_550, count: 3 });
  });

  it("spends nothing, not minus nothing, with no rows", () => {
    expect(Object.is(spendTotals([]).spentCents, 0)).toBe(true);
  });
});

describe("asksClassification", () => {
  it("asks for repairs, and for any spend on a capital item", () => {
    expect(asksClassification("repairs", null)).toBe(true);
    expect(
      asksClassification("supplies", "0199a2b4-0000-7000-8000-000000000001"),
    ).toBe(true);
    expect(asksClassification("utilities", null)).toBe(false);
  });
});

describe("categoryForTrade", () => {
  it("files upkeep as cleaning and maintenance, and an untraded job as a repair", () => {
    expect(categoryForTrade("landscaper")).toBe("cleaning");
    expect(categoryForTrade("cpa")).toBe("professional-fees");
    expect(categoryForTrade("plumber")).toBe("repairs");
    expect(categoryForTrade(null)).toBe("repairs");
  });
});

describe("expensesHref", () => {
  it("writes the params in one order, and none for the plain page", () => {
    expect(
      expensesHref({
        month: null,
        building: null,
        category: null,
        expense: null,
      }),
    ).toBe("/expenses");
    expect(
      expensesHref({
        expense: "new",
        category: "repairs",
        building: "b1",
        month: "2026-03",
      }),
    ).toBe("/expenses?month=2026-03&building=b1&category=repairs&expense=new");
  });
});
