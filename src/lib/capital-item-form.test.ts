/**
 * `Confirm` and `Record replacement`. Their rules are each a way an install
 * could be recorded as something that did not happen: no date on an audited
 * item, a date not yet reached, a new item older than the one it replaced.
 */
import { describe, expect, it } from "vitest";

import {
  validateConfirmation,
  validateReplacement,
} from "@/lib/capital-item-form";
import { UNREADABLE_FORM } from "@/lib/forms";

const TODAY = "2026-09-15";

/** A furnace somebody guessed went in in 2009. */
const ESTIMATED = { installYear: 2009, installDate: null };

describe("validateConfirmation", () => {
  it("records the day it went in, its year, and what it cost", () => {
    expect(
      validateConfirmation({ installedOn: "2011-03-09", cost: "4,180" }, TODAY),
    ).toEqual({
      ok: true,
      values: {
        installDate: "2011-03-09",
        installYear: 2011,
        actualCostCents: 418_000,
      },
    });
  });

  it("takes no cost as unknown", () => {
    expect(
      validateConfirmation({ installedOn: "2011-03-09", cost: "" }, TODAY),
    ).toMatchObject({ ok: true, values: { actualCostCents: null } });
  });

  it("requires a real date, today or earlier", () => {
    expect(validateConfirmation({ installedOn: "", cost: "" }, TODAY)).toEqual({
      ok: false,
      errors: { installedOn: "Enter the day it was installed." },
    });
    expect(
      validateConfirmation({ installedOn: "2026-09-16", cost: "" }, TODAY),
    ).toEqual({
      ok: false,
      errors: { installedOn: "Enter today’s date or an earlier one." },
    });
    expect(
      validateConfirmation({ installedOn: TODAY, cost: "" }, TODAY).ok,
    ).toBe(true);
  });

  it("refuses a year the database would, rather than failing the save", () => {
    // `<input type="date">` accepts year 0212 as readily as 2012.
    expect(
      validateConfirmation({ installedOn: "0212-05-01", cost: "" }, TODAY),
    ).toEqual({
      ok: false,
      errors: { installedOn: "Enter a date in 1600 or later." },
    });
  });

  it("refuses a submission the form could not have made", () => {
    expect(validateConfirmation({ cost: "" }, TODAY)).toEqual({
      ok: false,
      errors: { form: UNREADABLE_FORM },
    });
  });
});

describe("validateReplacement", () => {
  it("records the day it went in, its year, and what it cost", () => {
    expect(
      validateReplacement(
        { installedOn: "2026-08-02", cost: "$7,420.50" },
        TODAY,
        ESTIMATED,
      ),
    ).toEqual({
      ok: true,
      values: {
        installDate: "2026-08-02",
        installYear: 2026,
        actualCostCents: 742_050,
      },
    });
  });

  it("takes no cost as unknown, and $0 as nothing paid", () => {
    expect(
      validateReplacement(
        { installedOn: "2026-08-02", cost: " " },
        TODAY,
        ESTIMATED,
      ),
    ).toMatchObject({ ok: true, values: { actualCostCents: null } });
    expect(
      validateReplacement(
        { installedOn: "2026-08-02", cost: "0" },
        TODAY,
        ESTIMATED,
      ),
    ).toMatchObject({ ok: true, values: { actualCostCents: 0 } });
  });

  it("requires a real date, today or earlier", () => {
    expect(
      validateReplacement({ installedOn: "", cost: "" }, TODAY, ESTIMATED),
    ).toEqual({
      ok: false,
      errors: { installedOn: "Enter the day the new one was installed." },
    });
    expect(
      validateReplacement(
        { installedOn: "2026-02-30", cost: "" },
        TODAY,
        ESTIMATED,
      ),
    ).toEqual({
      ok: false,
      errors: { installedOn: "Enter the whole date — day, month and year." },
    });
    expect(
      validateReplacement(
        { installedOn: "2026-09-16", cost: "" },
        TODAY,
        ESTIMATED,
      ),
    ).toEqual({
      ok: false,
      errors: { installedOn: "Enter today’s date or an earlier one." },
    });
    // Today itself is fine: the plumber left an hour ago.
    expect(
      validateReplacement({ installedOn: TODAY, cost: "" }, TODAY, ESTIMATED)
        .ok,
    ).toBe(true);
  });

  it("refuses a new item older than the one it replaces, and allows the same year", () => {
    expect(
      validateReplacement(
        { installedOn: "2008-12-31", cost: "" },
        TODAY,
        ESTIMATED,
      ),
    ).toEqual({
      ok: false,
      errors: {
        installedOn:
          "Enter a date in 2009 or later — the one it replaces went in then.",
      },
    });
    // A lemon replaced the year it went in.
    expect(
      validateReplacement(
        { installedOn: "2009-11-02", cost: "" },
        TODAY,
        ESTIMATED,
      ).ok,
    ).toBe(true);
  });

  it("refuses a date before an audited predecessor's, in the same year", () => {
    // The year alone would let the new furnace go in seven months before the
    // one it replaced.
    const audited = { installYear: 2009, installDate: "2009-10-12" };

    expect(
      validateReplacement(
        { installedOn: "2009-03-01", cost: "" },
        TODAY,
        audited,
      ),
    ).toEqual({
      ok: false,
      errors: {
        installedOn:
          "Enter Oct 12, 2009 or later — the one it replaces went in then.",
      },
    });
    expect(
      validateReplacement(
        { installedOn: "2009-10-12", cost: "" },
        TODAY,
        audited,
      ).ok,
    ).toBe(true);
  });

  it("says what is wrong with every field at once", () => {
    expect(
      validateReplacement({ installedOn: "", cost: "-40" }, TODAY, ESTIMATED),
    ).toEqual({
      ok: false,
      errors: {
        installedOn: "Enter the day the new one was installed.",
        cost: "Enter the amount without a minus sign.",
      },
    });
  });

  it("refuses a submission the form could not have made", () => {
    expect(
      validateReplacement({ installedOn: 20260802 }, TODAY, ESTIMATED),
    ).toEqual({ ok: false, errors: { form: UNREADABLE_FORM } });
  });
});
