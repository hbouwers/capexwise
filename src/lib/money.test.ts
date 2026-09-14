/**
 * Every tax and forecast figure passes through this file, so the cases below
 * are the ones where the obvious implementation is wrong: halves, negatives,
 * the step from thousands to millions, and cents that do not divide evenly.
 */
import { describe, expect, it } from "vitest";

import { formatMoney, parseMoney, splitCents } from "@/lib/money";

describe("formatMoney", () => {
  it("renders whole dollars with grouping by default", () => {
    expect(formatMoney(840_000)).toBe("$8,400");
    expect(formatMoney(123_456_789_00)).toBe("$123,456,789");
    expect(formatMoney(0)).toBe("$0");
  });

  it("rounds to the dollar at display, halves away from zero", () => {
    expect(formatMoney(840_049)).toBe("$8,400");
    expect(formatMoney(840_050)).toBe("$8,401");
    expect(formatMoney(-840_050)).toBe("−$8,401");
    expect(formatMoney(99_950)).toBe("$1,000");
  });

  it("always renders the sign of a negative, with a real minus", () => {
    // data-model §6: `transactions.amount_cents` is signed, and the formatter
    // has to render money out correctly. U+2212, not a hyphen.
    expect(formatMoney(-540_000)).toBe("−$5,400");
    expect(formatMoney(-540_000, { form: "cents" })).toBe("−$5,400.00");
    expect(formatMoney(-3_970_000, { form: "compact" })).toBe("−$39.7k");
  });

  it("renders a plus only when asked", () => {
    expect(formatMoney(4_480_000, { signed: true })).toBe("+$44,800");
    expect(formatMoney(-540_000, { signed: true })).toBe("−$5,400");
  });

  it("gives a figure that rounds to zero no sign", () => {
    // A 30-cent shortfall shown as −$0 claims a direction the figure cannot.
    expect(formatMoney(-30)).toBe("$0");
    expect(formatMoney(30, { signed: true })).toBe("$0");
    expect(formatMoney(-49, { form: "compact" })).toBe("$0");
    expect(formatMoney(0, { form: "cents", signed: true })).toBe("$0.00");
    // …but a figure that shows cents shows them with their sign.
    expect(formatMoney(-30, { form: "cents" })).toBe("−$0.30");
  });

  it("renders cents exactly, so a prefilled form does not round on save", () => {
    expect(formatMoney(1_000_001, { form: "cents" })).toBe("$10,000.01");
    expect(formatMoney(840_050, { form: "cents" })).toBe("$8,400.50");
    expect(formatMoney(5, { form: "cents" })).toBe("$0.05");
  });

  describe("compact", () => {
    it("keeps whole dollars under a thousand", () => {
      expect(formatMoney(84_000, { form: "compact" })).toBe("$840");
      expect(formatMoney(99_949, { form: "compact" })).toBe("$999");
    });

    it("renders thousands to one decimal and drops a trailing .0", () => {
      expect(formatMoney(3_970_000, { form: "compact" })).toBe("$39.7k");
      expect(formatMoney(3_974_900, { form: "compact" })).toBe("$39.7k");
      expect(formatMoney(3_975_000, { form: "compact" })).toBe("$39.8k");
      expect(formatMoney(4_000_000, { form: "compact" })).toBe("$40k");
      expect(formatMoney(99_950, { form: "compact" })).toBe("$1k");
    });

    it("moves to millions from the cents, not from the rounded thousands", () => {
      // The boundary a step-by-step implementation gets wrong: $999,960 is
      // 1000.0 thousands, which must render as a million, not `$1000k`.
      expect(formatMoney(99_996_000, { form: "compact" })).toBe("$1M");
      expect(formatMoney(99_994_999, { form: "compact" })).toBe("$999.9k");
      expect(formatMoney(125_000_000, { form: "compact" })).toBe("$1.3M");
      expect(formatMoney(1_234_500_000_00, { form: "compact" })).toBe(
        "$1,234.5M",
      );
    });
  });

  it("refuses anything that is not a whole number of cents", () => {
    // A fraction of a cent is a float that got through. Whole dollars passed
    // as cents are integers and pass; naming is what guards those.
    expect(() => formatMoney(84.5)).toThrow(TypeError);
    expect(() => formatMoney(Number.NaN)).toThrow(TypeError);
    expect(() => formatMoney(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => formatMoney(2 ** 53)).toThrow(TypeError);
  });
});

describe("parseMoney", () => {
  it.each([
    ["8400", 840_000],
    ["8,400", 840_000],
    ["$8,400", 840_000],
    ["$ 8,400.00", 840_000],
    ["  8400.5 ", 840_050],
    ["8400.", 840_000],
    [".50", 50],
    ["0.05", 5],
    ["0", 0],
    ["1,234,567.89", 123_456_789],
  ])("reads %j as %i cents", (input, cents) => {
    expect(parseMoney(input)).toEqual({ ok: true, cents });
  });

  it("round-trips the exact form", () => {
    for (const cents of [0, 5, 50, 840_050, 1_000_001, 123_456_789]) {
      expect(parseMoney(formatMoney(cents, { form: "cents" }))).toEqual({
        ok: true,
        cents,
      });
    }
  });

  it("refuses a fraction of a cent rather than rounding it", () => {
    expect(parseMoney("8,400.505")).toEqual({
      ok: false,
      reason: "fraction-of-a-cent",
    });
    expect(parseMoney("0.001")).toEqual({
      ok: false,
      reason: "fraction-of-a-cent",
    });
  });

  it("refuses a negative, since every amount a person types is a magnitude", () => {
    for (const input of ["-5", "−5", "$-5", "-$5"]) {
      expect(parseMoney(input)).toEqual({ ok: false, reason: "negative" });
    }
  });

  it("calls an empty field empty", () => {
    expect(parseMoney("")).toEqual({ ok: false, reason: "empty" });
    expect(parseMoney("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it.each([
    "abc",
    "$",
    ".",
    "1e5",
    "8,40,0",
    "84,00",
    "8 400",
    "1.2.3",
    "0x10",
  ])("refuses %j", (input) => {
    expect(parseMoney(input)).toEqual({ ok: false, reason: "not-a-number" });
  });

  it("refuses an amount too large to hold exactly", () => {
    expect(parseMoney("999999999999999999")).toEqual({
      ok: false,
      reason: "not-a-number",
    });
  });
});

describe("splitCents", () => {
  const sum = (parts: number[]) => parts.reduce((a, b) => a + b, 0);

  it("splits $10,000.01 across two units as 500001 and 500000", () => {
    // The worked example in data-model §5 and ADR-0005.
    expect(splitCents(1_000_001, [1, 1])).toEqual([500_001, 500_000]);
  });

  it("gives the leftover cents to the largest remainders", () => {
    // 100 cents by 1:1:1 is 33⅓ each; one cent is left, and the tie goes to
    // the first part.
    expect(splitCents(100, [1, 1, 1])).toEqual([34, 33, 33]);
    // 1000 by 1:2:4 is 142.86, 285.71, 571.43. The floors leave two cents,
    // and they go to the .86 and the .71 — not to the largest part.
    expect(splitCents(1000, [1, 2, 4])).toEqual([143, 286, 571]);
  });

  it("splits by basis points for an explicit allocation", () => {
    expect(splitCents(1_000_001, [6000, 4000])).toEqual([600_001, 400_000]);
    expect(splitCents(999, [3333, 3333, 3334])).toEqual([333, 333, 333]);
  });

  it("always sums to the total", () => {
    const totals = [0, 1, 7, 99, 1_000_001, 123_456_789, 2 ** 53 - 1];
    const weightSets = [
      [1],
      [1, 1],
      [1, 1, 1],
      [1, 2, 4],
      [3333, 3333, 3334],
      [0, 1, 0, 5],
    ];
    for (const total of totals) {
      for (const weights of weightSets) {
        const parts = splitCents(total, weights);
        expect(parts).toHaveLength(weights.length);
        expect(sum(parts)).toBe(total);
      }
    }
  });

  it("never gives a leftover cent to a part with no weight", () => {
    expect(splitCents(5, [0, 1, 1, 0])).toEqual([0, 3, 2, 0]);
  });

  it("splits a negative total as the mirror of the positive one", () => {
    expect(splitCents(-1_000_001, [1, 1])).toEqual([-500_001, -500_000]);
    expect(splitCents(-1, [1, 1])).toEqual([-1, 0]);
  });

  it("refuses what it cannot split", () => {
    expect(() => splitCents(10.5, [1, 1])).toThrow(TypeError);
    expect(() => splitCents(100, [])).toThrow(RangeError);
    expect(() => splitCents(100, [0, 0])).toThrow(RangeError);
    expect(() => splitCents(100, [1, -1])).toThrow(RangeError);
    expect(() => splitCents(100, [0.5, 0.5])).toThrow(RangeError);
  });
});
