/**
 * `Confirm`, `Record replacement` and the item editor. Their rules are each
 * a way an item could be recorded as something that is not so: no date on an
 * audited item, a date not yet reached, a new item older than the one it
 * replaced, a life of zero years for the forecast to divide by.
 */
import { describe, expect, it } from "vitest";

import {
  itemFields,
  validateCapitalItem,
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

describe("validateCapitalItem", () => {
  /** The editor's form for a furnace as the checklist added it, corrected. */
  const FURNACE = {
    label: " Furnace, basement ",
    confidence: "estimated",
    installYear: "2011",
    installedOn: "",
    cost: "",
    expectedLife: "18",
    replacementCost: "$5,200",
    scope: "shared",
    notes: "  Carrier 58STA, serial on the door.  ",
  };

  const UNIT = "019250d4-6f4e-7b3a-9c1e-8d2f5a6b7c8d";

  it("reads an estimated item: its year, its figures, trimmed text", () => {
    expect(validateCapitalItem(FURNACE, TODAY)).toEqual({
      ok: true,
      values: {
        label: "Furnace, basement",
        confidence: "estimated",
        installYear: 2011,
        installDate: null,
        actualCostCents: null,
        expectedLifeYears: 18,
        replacementCostCents: 520_000,
        unitId: null,
        notes: "Carrier 58STA, serial on the door.",
      },
    });
  });

  it("reads an audited item's year from its date, and ignores the year field", () => {
    expect(
      validateCapitalItem(
        {
          ...FURNACE,
          confidence: "audited",
          installYear: "1999",
          installedOn: "2011-03-09",
          cost: "4,180",
          scope: UNIT,
          notes: "",
        },
        TODAY,
      ),
    ).toMatchObject({
      ok: true,
      values: {
        confidence: "audited",
        installYear: 2011,
        installDate: "2011-03-09",
        actualCostCents: 418_000,
        unitId: UNIT,
        notes: null,
      },
    });
  });

  it("ignores a stale date on an item switched back to estimated", () => {
    expect(
      validateCapitalItem({ ...FURNACE, installedOn: "not a date" }, TODAY),
    ).toMatchObject({ ok: true, values: { installDate: null } });
  });

  it("requires a label, and keeps it short", () => {
    expect(validateCapitalItem({ ...FURNACE, label: " " }, TODAY)).toEqual({
      ok: false,
      errors: { label: "Enter what the item is called." },
    });
    expect(
      validateCapitalItem({ ...FURNACE, label: "x".repeat(201) }, TODAY),
    ).toEqual({
      ok: false,
      errors: {
        label: "Keep it to 200 characters — put the rest in the notes.",
      },
    });
  });

  it("holds an estimated year to four digits, plausible and not in the future", () => {
    const year = (installYear: string) =>
      validateCapitalItem({ ...FURNACE, installYear }, TODAY);

    expect(year("")).toEqual({
      ok: false,
      errors: { installYear: "Enter the year it was installed, like 2014." },
    });
    expect(year("14")).toEqual({
      ok: false,
      errors: { installYear: "Enter the year as four digits, like 2014." },
    });
    expect(year("2014.5")).toEqual({
      ok: false,
      errors: { installYear: "Enter the year as four digits, like 2014." },
    });
    expect(year("1599")).toEqual({
      ok: false,
      errors: { installYear: "Enter a year in 1600 or later." },
    });
    expect(year("2027")).toEqual({
      ok: false,
      errors: { installYear: "Enter this year or an earlier one." },
    });
    expect(year("2026").ok).toBe(true);
  });

  it("holds an audited date to Confirm's rules", () => {
    const date = (installedOn: string) =>
      validateCapitalItem(
        { ...FURNACE, confidence: "audited", installedOn },
        TODAY,
      );

    expect(date("")).toEqual({
      ok: false,
      errors: { installedOn: "Enter the day it was installed." },
    });
    expect(date("2026-09-16")).toEqual({
      ok: false,
      errors: { installedOn: "Enter today’s date or an earlier one." },
    });
    expect(date(TODAY).ok).toBe(true);
  });

  it("requires a whole number of years, at least one", () => {
    const life = (expectedLife: string) =>
      validateCapitalItem({ ...FURNACE, expectedLife }, TODAY);

    expect(life("")).toEqual({
      ok: false,
      errors: { expectedLife: "Enter how many years it typically lasts." },
    });
    expect(life("0")).toEqual({
      ok: false,
      errors: { expectedLife: "Enter a whole number of years, like 15." },
    });
    expect(life("12.5")).toEqual({
      ok: false,
      errors: { expectedLife: "Enter a whole number of years, like 15." },
    });
    expect(life("201")).toEqual({
      ok: false,
      errors: { expectedLife: "Enter 200 years or fewer." },
    });
    expect(life("1").ok).toBe(true);
  });

  it("requires a replacement cost, and allows nothing", () => {
    expect(
      validateCapitalItem({ ...FURNACE, replacementCost: "" }, TODAY),
    ).toEqual({
      ok: false,
      errors: { replacementCost: "Enter what replacing it would cost." },
    });
    expect(
      validateCapitalItem({ ...FURNACE, replacementCost: "-5" }, TODAY),
    ).toEqual({
      ok: false,
      errors: { replacementCost: "Enter the amount without a minus sign." },
    });
    expect(
      validateCapitalItem({ ...FURNACE, replacementCost: "0" }, TODAY),
    ).toMatchObject({ ok: true, values: { replacementCostCents: 0 } });
  });

  it("reports every field at once", () => {
    expect(
      validateCapitalItem(
        {
          ...FURNACE,
          label: "",
          installYear: "abcd",
          cost: "ten",
          expectedLife: "",
          replacementCost: "",
          notes: "n".repeat(5001),
        },
        TODAY,
      ),
    ).toEqual({
      ok: false,
      errors: {
        label: "Enter what the item is called.",
        installYear: "Enter the year as four digits, like 2014.",
        cost: "Enter an amount in dollars, like 1,250.",
        expectedLife: "Enter how many years it typically lasts.",
        replacementCost: "Enter what replacing it would cost.",
        notes: "Keep the notes to 5,000 characters.",
      },
    });
  });

  it("refuses a confidence or a scope the form could not have sent", () => {
    expect(
      validateCapitalItem({ ...FURNACE, confidence: "guessed" }, TODAY),
    ).toEqual({ ok: false, errors: { form: UNREADABLE_FORM } });
    expect(
      validateCapitalItem({ ...FURNACE, scope: "upstairs" }, TODAY),
    ).toEqual({ ok: false, errors: { form: UNREADABLE_FORM } });
    expect(validateCapitalItem({ label: "Furnace" }, TODAY)).toEqual({
      ok: false,
      errors: { form: UNREADABLE_FORM },
    });
  });
});

describe("itemFields", () => {
  it("fills the form from the row, and reads back to the same values", () => {
    const fields = itemFields({
      label: "Water heater",
      confidence: "audited",
      installYear: 2019,
      installDate: "2019-07-22",
      actualCostCents: 145_050,
      expectedLifeYears: 12,
      replacementCostCents: 180_000,
      unitId: null,
      notes: null,
    });

    expect(fields).toEqual({
      label: "Water heater",
      confidence: "audited",
      installYear: "2019",
      installedOn: "2019-07-22",
      cost: "$1,450.50",
      expectedLife: "12",
      replacementCost: "$1,800",
      scope: "shared",
      notes: "",
    });
    expect(validateCapitalItem(fields, TODAY)).toMatchObject({
      ok: true,
      values: {
        installYear: 2019,
        installDate: "2019-07-22",
        actualCostCents: 145_050,
        replacementCostCents: 180_000,
        unitId: null,
        notes: null,
      },
    });
  });
});
