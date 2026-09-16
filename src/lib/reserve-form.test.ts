/**
 * `Update reserve`. The rules are the schema's all-or-none, and the two ways a
 * reserve could be entered as something nobody has seen: a date not reached
 * yet, and an empty field read as zero.
 */
import { describe, expect, it } from "vitest";

import { UNREADABLE_FORM } from "@/lib/forms";
import { validateReserve } from "@/lib/reserve-form";

const TODAY = "2026-09-16";

describe("validateReserve", () => {
  it("records the balance, its date and the contribution", () => {
    expect(
      validateReserve(
        { balance: "18,400", asOf: "2026-09-03", contribution: "750" },
        TODAY,
      ),
    ).toEqual({
      ok: true,
      values: {
        reserveBalanceCents: 1_840_000,
        reserveAsOf: "2026-09-03",
        reserveMonthlyContributionCents: 75_000,
      },
    });
  });

  it("accepts $0 for either amount, and today's date", () => {
    expect(
      validateReserve({ balance: "0", asOf: TODAY, contribution: "$0" }, TODAY),
    ).toMatchObject({
      ok: true,
      values: { reserveBalanceCents: 0, reserveMonthlyContributionCents: 0 },
    });
  });

  it("requires all three, rather than reading an empty amount as zero", () => {
    expect(
      validateReserve({ balance: "", asOf: "", contribution: "" }, TODAY),
    ).toEqual({
      ok: false,
      errors: {
        balance: expect.any(String),
        asOf: expect.any(String),
        contribution: expect.any(String),
      },
    });
  });

  it("refuses a date after today, and one that is not a day", () => {
    expect(
      validateReserve(
        { balance: "1", asOf: "2026-09-17", contribution: "1" },
        TODAY,
      ),
    ).toEqual({
      ok: false,
      errors: { asOf: "Enter today’s date or an earlier one." },
    });
    expect(
      validateReserve(
        { balance: "1", asOf: "2026-02-30", contribution: "1" },
        TODAY,
      ),
    ).toMatchObject({ ok: false, errors: { asOf: expect.any(String) } });
  });

  it("says what to change about an amount", () => {
    expect(
      validateReserve(
        { balance: "-5", asOf: TODAY, contribution: "12.345" },
        TODAY,
      ),
    ).toEqual({
      ok: false,
      errors: {
        balance: "Enter the amount without a minus sign.",
        contribution:
          "Enter the amount to the cent — two decimal places at most.",
      },
    });
  });

  it("refuses a submission the form could not have made", () => {
    expect(validateReserve({ balance: 5 }, TODAY)).toEqual({
      ok: false,
      errors: { form: UNREADABLE_FORM },
    });
  });
});
