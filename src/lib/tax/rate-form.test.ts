import { describe, expect, it } from "vitest";

import { formatRate, validateRate } from "@/lib/tax/rate-form";

describe("validateRate", () => {
  it("reads a percentage into basis points", () => {
    expect(validateRate({ rate: "29" })).toEqual({ ok: true, rateBps: 2_900 });
    expect(validateRate({ rate: " 29.5 % " })).toEqual({
      ok: true,
      rateBps: 2_950,
    });
    expect(validateRate({ rate: "29.25%" })).toEqual({
      ok: true,
      rateBps: 2_925,
    });
    expect(validateRate({ rate: "0" })).toEqual({ ok: true, rateBps: 0 });
    expect(validateRate({ rate: "100" })).toEqual({
      ok: true,
      rateBps: 10_000,
    });
  });

  it("asks for a rate rather than taking an empty field as zero", () => {
    expect(validateRate({ rate: "  " })).toEqual({
      ok: false,
      errors: { rate: "Enter your blended rate, as a percentage." },
    });
  });

  it("refuses a rate it cannot store exactly, or over 100%", () => {
    for (const rate of ["29.125", "-5", "twenty", "0.29e2", "1e3"]) {
      expect(validateRate({ rate }).ok).toBe(false);
    }
    expect(validateRate({ rate: "100.01" })).toEqual({
      ok: false,
      errors: { rate: "Enter a rate of 100% or less." },
    });
  });

  it("refuses a submission the form could not have made", () => {
    expect(validateRate({ rate: 29 }).ok).toBe(false);
    expect(validateRate(null).ok).toBe(false);
  });
});

describe("formatRate", () => {
  it("writes the rate as it would be typed", () => {
    expect(formatRate(2_900)).toBe("29%");
    expect(formatRate(2_950)).toBe("29.5%");
    expect(formatRate(2_925)).toBe("29.25%");
    expect(formatRate(5)).toBe("0.05%");
    expect(formatRate(0)).toBe("0%");
  });

  it("round-trips through the form", () => {
    for (const bps of [0, 5, 50, 1_234, 2_900, 10_000]) {
      expect(validateRate({ rate: formatRate(bps) })).toEqual({
        ok: true,
        rateBps: bps,
      });
    }
  });
});
