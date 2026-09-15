/**
 * The Other amount form. Its rules are few and each is a way a payment could
 * be recorded as something that did not happen: a date with nothing beside
 * it, money on a month nobody owed, `$0` standing in for "nothing arrived", a
 * payment dated in the future.
 */
import { describe, expect, it } from "vitest";

import { UNREADABLE_FORM } from "@/lib/forms";
import {
  newRentPeriodFields,
  type RentPeriodFields,
  rentPeriodFields,
  validateRentPeriod,
} from "@/lib/rent-period-form";

const TODAY = "2026-09-14";

function fields(overrides: Partial<RentPeriodFields> = {}): RentPeriodFields {
  return {
    expected: "$2,300",
    received: "",
    receivedOn: "2026-09-14",
    note: "",
    vacant: false,
    ...overrides,
  };
}

describe("validateRentPeriod", () => {
  it("records a partial payment on the day it arrived", () => {
    expect(
      validateRentPeriod(
        fields({ received: "1,200", receivedOn: "2026-09-03", note: " late " }),
        TODAY,
      ),
    ).toEqual({
      ok: true,
      values: {
        amountExpectedCents: 230_000,
        amountReceivedCents: 120_000,
        receivedOn: "2026-09-03",
        note: "late",
        vacant: false,
      },
    });
  });

  it("corrects the expected amount alone, ignoring the prefilled date", () => {
    // The date is filled in whether or not anything arrived, so a form opened
    // for a retroactive rent change must not ask for it to be cleared.
    expect(validateRentPeriod(fields({ expected: "2,150" }), TODAY)).toEqual({
      ok: true,
      values: {
        amountExpectedCents: 215_000,
        amountReceivedCents: null,
        receivedOn: null,
        note: null,
        vacant: false,
      },
    });
  });

  it("drops what was typed into a month marked vacant", () => {
    const result = validateRentPeriod(
      fields({ received: "1,200", vacant: true }),
      TODAY,
    );

    expect(result).toMatchObject({
      ok: true,
      values: { amountReceivedCents: null, receivedOn: null, vacant: true },
    });
  });

  it("asks for the expected amount", () => {
    expect(validateRentPeriod(fields({ expected: " " }), TODAY)).toEqual({
      ok: false,
      errors: { expected: "Enter the rent expected for the month." },
    });
  });

  it("refuses $0 received, which is a payment saying none arrived", () => {
    expect(validateRentPeriod(fields({ received: "$0" }), TODAY)).toEqual({
      ok: false,
      errors: { received: "Leave it empty if nothing arrived." },
    });
  });

  it("asks when an amount arrived, and refuses a day still to come", () => {
    expect(
      validateRentPeriod(fields({ received: "2,300", receivedOn: "" }), TODAY),
    ).toEqual({
      ok: false,
      errors: { receivedOn: "Enter the day it arrived." },
    });
    expect(
      validateRentPeriod(
        fields({ received: "2,300", receivedOn: "2026-09-15" }),
        TODAY,
      ),
    ).toEqual({
      ok: false,
      errors: { receivedOn: "Enter today’s date or an earlier one." },
    });
    expect(
      validateRentPeriod(
        fields({ received: "2,300", receivedOn: "2026-02-30" }),
        TODAY,
      ).ok,
    ).toBe(false);
  });

  it("accepts rent that arrived before its month began", () => {
    // September's rent paid on 28 August is early, not wrong.
    expect(
      validateRentPeriod(
        fields({ received: "2,300", receivedOn: "2026-08-28" }),
        TODAY,
      ).ok,
    ).toBe(true);
  });

  it("reports every problem at once", () => {
    const result = validateRentPeriod(
      fields({ expected: "abc", received: "12.345" }),
      TODAY,
    );

    expect(result.ok).toBe(false);
    expect(Object.keys(result.ok ? {} : result.errors).sort()).toEqual([
      "expected",
      "received",
    ]);
  });

  it("refuses a submission the form could not have made", () => {
    expect(validateRentPeriod({ ...fields(), vacant: "yes" }, TODAY)).toEqual({
      ok: false,
      errors: { form: UNREADABLE_FORM },
    });
  });
});

describe("rentPeriodFields", () => {
  const period = {
    periodMonth: "2026-01-01",
    amountExpectedCents: 230_000,
    amountReceivedCents: null,
    receivedOn: null,
    note: null,
    vacant: false,
  };

  it("prefills the date Mark paid would record", () => {
    // The period's first day for a past month, today for the current one.
    expect(rentPeriodFields(period, TODAY).receivedOn).toBe("2026-01-01");
    expect(
      rentPeriodFields({ ...period, periodMonth: "2026-09-01" }, TODAY)
        .receivedOn,
    ).toBe(TODAY);
  });

  it("prefills what is stored, exactly", () => {
    expect(
      rentPeriodFields(
        {
          ...period,
          amountReceivedCents: 120_050,
          receivedOn: "2026-01-06",
          note: "rest on the 20th",
        },
        TODAY,
      ),
    ).toEqual({
      expected: "$2,300",
      received: "$1,200.50",
      receivedOn: "2026-01-06",
      note: "rest on the 20th",
      vacant: false,
    });
  });
});

describe("newRentPeriodFields", () => {
  it("starts from the unit's rent today, and nothing received", () => {
    expect(newRentPeriodFields("2026-03-01", 195_000, TODAY)).toEqual({
      expected: "$1,950",
      received: "",
      receivedOn: "2026-03-01",
      note: "",
      vacant: false,
    });
    expect(newRentPeriodFields("2026-03-01", null, TODAY).expected).toBe("");
  });
});
