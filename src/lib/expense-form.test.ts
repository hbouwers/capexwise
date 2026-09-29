/**
 * The expense modal's rules, which the modal and the action both run. The
 * ones a mistake would reach a tax page through: the sign the direction
 * gives, a classification kept only where it is asked, and a date after
 * today refused.
 */
import { describe, expect, it } from "vitest";

import {
  emptyExpenseFields,
  type ExpenseFields,
  expenseFields,
  FUTURE_DATE,
  nextExpenseFields,
  validateExpense,
} from "@/lib/expense-form";
import { UNREADABLE_FORM } from "@/lib/forms";

const TODAY = "2026-09-29";
const BUILDING = "0199a2b4-0000-7000-8000-000000000001";
const UNIT = "0199a2b4-0000-7000-8000-000000000002";
const ITEM = "0199a2b4-0000-7000-8000-000000000003";

function form(overrides: Partial<ExpenseFields> = {}): ExpenseFields {
  return {
    ...emptyExpenseFields({ today: "2026-09-16" }),
    amount: "180",
    buildingId: BUILDING,
    category: "repairs",
    description: "  Replaced the kitchen faucet  ",
    ...overrides,
  };
}

describe("validateExpense", () => {
  it("stores money out as negative cents, trimmed, and a repair as unclassified", () => {
    expect(validateExpense(form(), TODAY)).toEqual({
      ok: true,
      values: {
        occurredOn: "2026-09-16",
        amountCents: -18_000,
        buildingId: BUILDING,
        unitId: null,
        scheduleECategory: "repairs",
        description: "Replaced the kitchen faucet",
        classification: "unclassified",
        capitalItemId: null,
        contactId: null,
        taskId: null,
      },
    });
  });

  it("stores a refund as positive, and a unit's scope as its id", () => {
    const result = validateExpense(
      form({ amount: "$40.25", direction: "refund", scope: UNIT }),
      TODAY,
    );

    expect(result).toMatchObject({
      ok: true,
      values: { amountCents: 4_025, unitId: UNIT },
    });
  });

  it("keeps a classification only where one is asked", () => {
    expect(
      validateExpense(
        form({ category: "utilities", classification: "improvement" }),
        TODAY,
      ),
    ).toMatchObject({ ok: true, values: { classification: null } });

    expect(
      validateExpense(
        form({
          category: "supplies",
          equipment: ITEM,
          classification: "improvement",
        }),
        TODAY,
      ),
    ).toMatchObject({
      ok: true,
      values: { classification: "improvement", capitalItemId: ITEM },
    });
  });

  it("refuses a date after today, and says nothing about it before the building is known", () => {
    const later = form({ occurredOn: "2026-09-30" });

    expect(validateExpense(later, TODAY)).toEqual({
      ok: false,
      errors: { occurredOn: FUTURE_DATE },
    });
    expect(validateExpense(later, null).ok).toBe(true);
  });

  it("says every missing thing at once", () => {
    expect(
      validateExpense(
        form({ occurredOn: "", amount: "", buildingId: "", category: "" }),
        TODAY,
      ),
    ).toEqual({
      ok: false,
      errors: {
        occurredOn: "Enter the date on the receipt.",
        amount: "Enter what it cost.",
        buildingId: "Choose the building it was for.",
        category: "Choose a Schedule E category.",
      },
    });
  });

  it("refuses zero and a minus sign, which the direction says instead", () => {
    expect(validateExpense(form({ amount: "0" }), TODAY)).toMatchObject({
      ok: false,
      errors: { amount: "Enter an amount above zero." },
    });
    expect(validateExpense(form({ amount: "-180" }), TODAY)).toMatchObject({
      ok: false,
      errors: { amount: "Enter the amount without a minus sign." },
    });
  });

  it("refuses a year that is a typo", () => {
    expect(
      validateExpense(form({ occurredOn: "0226-09-16" }), TODAY),
    ).toMatchObject({ ok: false, errors: { occurredOn: expect.any(String) } });
  });

  it("refuses what the form could not have sent", () => {
    for (const bad of [
      form({ scope: "unit-a" }),
      form({ category: "Repairs; drop table" }),
      form({ classification: "capital" }),
      { ...form(), direction: "sideways" },
      null,
    ]) {
      expect(validateExpense(bad, TODAY)).toEqual({
        ok: false,
        errors: { form: UNREADABLE_FORM },
      });
    }
  });
});

describe("nextExpenseFields", () => {
  it("keeps the date, building and category, and clears the rest", () => {
    const saved = form({
      scope: UNIT,
      equipment: ITEM,
      direction: "refund",
      classification: "repair",
    });

    expect(nextExpenseFields(saved)).toEqual({
      ...emptyExpenseFields({ today: "2026-09-16" }),
      buildingId: BUILDING,
      category: "repairs",
    });
  });
});

describe("expenseFields", () => {
  it("prefills the magnitude exactly, with the direction beside it", () => {
    expect(
      expenseFields({
        occurredOn: "2026-09-16",
        amountCents: -18_250,
        buildingId: BUILDING,
        unitId: null,
        scheduleECategory: "repairs",
        description: null,
        classification: null,
        capitalItemId: null,
        contactId: null,
        taskId: null,
      }),
    ).toMatchObject({ amount: "$182.50", direction: "out", scope: "shared" });
  });
});
