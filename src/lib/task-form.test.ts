/**
 * The task modal's rules where a wrong answer is quiet: a date that sets the
 * wrong status, an empty cost saved as zero, a completion recorded for a day
 * that has not come, and a confirmation carried over to a booking nobody made.
 */
import { describe, expect, it } from "vitest";

import { UNREADABLE_FORM } from "@/lib/forms";
import {
  confirmationOn,
  emptyTaskFields,
  MEMBER,
  NONE,
  type TaskFields,
  taskFields,
  validateCompletion,
  validateTask,
} from "@/lib/task-form";

const TODAY = "2026-09-16";
const BUILDING = "0199a8a0-0000-7000-8000-000000000001";
const UNIT = "0199a8a0-0000-7000-8000-000000000002";
const CONTACT = "0199a8a0-0000-7000-8000-000000000003";
const ITEM = "0199a8a0-0000-7000-8000-000000000004";

/** Gutters, booked with a contact for October, every three months. */
function gutters(overrides: Partial<TaskFields> = {}): TaskFields {
  return {
    ...emptyTaskFields(BUILDING),
    title: "  Clean the gutters ",
    notes: "Ladder is in the garage.\n",
    dueDate: "2026-10-01",
    assignee: CONTACT,
    confirmed: true,
    priority: "high",
    estCost: "$180",
    recurrence: "3",
    trade: "gutters",
    equipment: ITEM,
    ...overrides,
  };
}

describe("validateTask", () => {
  it("reads an open task's form into the columns it writes", () => {
    expect(validateTask(gutters(), { kind: "open" })).toEqual({
      ok: true,
      values: {
        title: "Clean the gutters",
        notes: "Ladder is in the garage.",
        priority: "high",
        estCostCents: 18_000,
        tradeTag: "gutters",
        capitalItemId: ITEM,
        assignee: { kind: "contact", contactId: CONTACT },
        confirmed: true,
        dueDate: "2026-10-01",
        recurrenceMonths: 3,
        completedOn: null,
        actualCostCents: null,
        buildingId: null,
        unitId: null,
      },
    });
  });

  it("takes empty fields as nothing, not as zero or a blank note", () => {
    const result = validateTask(
      gutters({
        notes: "   ",
        dueDate: "",
        assignee: NONE,
        estCost: "",
        recurrence: NONE,
        trade: NONE,
        equipment: NONE,
      }),
      { kind: "open" },
    );

    expect(result).toMatchObject({
      ok: true,
      values: {
        notes: null,
        dueDate: null,
        assignee: null,
        estCostCents: null,
        recurrenceMonths: null,
        tradeTag: null,
        capitalItemId: null,
      },
    });
  });

  it("allows a due date already past — an overdue job is still worth writing down", () => {
    expect(
      validateTask(gutters({ dueDate: "2025-01-01" }), { kind: "open" }),
    ).toMatchObject({ ok: true, values: { dueDate: "2025-01-01" } });
  });

  it("places a new task on its building and scope", () => {
    expect(
      validateTask(gutters({ scope: UNIT }), { kind: "new" }),
    ).toMatchObject({
      ok: true,
      values: { buildingId: BUILDING, unitId: UNIT },
    });
    expect(validateTask(gutters({ buildingId: "" }), { kind: "new" })).toEqual({
      ok: false,
      errors: { buildingId: "Choose the building it’s for." },
    });
  });

  it("ignores the building on a task that already has one", () => {
    expect(
      validateTask(gutters({ buildingId: "", scope: "?" }), { kind: "open" }),
    ).toMatchObject({ ok: true, values: { buildingId: null, unitId: null } });
  });

  it("reads a done task's completion instead of its date and repeat", () => {
    const result = validateTask(
      gutters({
        dueDate: "not read",
        recurrence: "not read",
        completedOn: "2026-09-14",
        actualCost: "212.50",
      }),
      { kind: "done", today: TODAY },
    );

    expect(result).toMatchObject({
      ok: true,
      values: {
        dueDate: null,
        recurrenceMonths: null,
        completedOn: "2026-09-14",
        actualCostCents: 21_250,
      },
    });
  });

  it("refuses a completion with no day, or one that has not come", () => {
    expect(
      validateTask(gutters({ completedOn: "" }), {
        kind: "done",
        today: TODAY,
      }),
    ).toEqual({
      ok: false,
      errors: { completedOn: "Enter the day it was done." },
    });
    expect(
      validateTask(gutters({ completedOn: "2026-09-17" }), {
        kind: "done",
        today: TODAY,
      }),
    ).toEqual({
      ok: false,
      errors: { completedOn: "Enter today’s date or an earlier one." },
    });
  });

  it("says what to change, field by field", () => {
    expect(
      validateTask(
        gutters({
          title: "",
          notes: "x".repeat(5001),
          dueDate: "0226-10-01",
          estCost: "12.345",
        }),
        { kind: "open" },
      ),
    ).toEqual({
      ok: false,
      errors: {
        title: "Enter what needs doing.",
        notes: "Keep the notes to 5,000 characters.",
        dueDate: "Enter a date in 1900 or later.",
        estCost: "Enter the amount to the cent — two decimal places at most.",
      },
    });
  });

  it("keeps another member as the assignee without naming them", () => {
    expect(
      validateTask(gutters({ assignee: MEMBER }), { kind: "open" }),
    ).toMatchObject({ ok: true, values: { assignee: { kind: "member" } } });
  });

  it.each([
    ["a submission that is not an object", "Clean the gutters"],
    ["a missing field", { title: "Clean the gutters" }],
    ["a priority the list does not have", gutters({ priority: "urgent" })],
    [
      "a priority off the object's prototype",
      gutters({ priority: "toString" }),
    ],
    ["a repeat the list does not have", gutters({ recurrence: "2" })],
    ["an assignee that is not an id", gutters({ assignee: "Dana" })],
    ["equipment that is not an id", gutters({ equipment: "furnace" })],
    ["a trade that is not a slug", gutters({ trade: "Gutters" })],
    ["a confirmation that is not a tick", { ...gutters(), confirmed: "yes" }],
  ])("refuses %s as unreadable", (_, input) => {
    expect(validateTask(input, { kind: "open" })).toEqual({
      ok: false,
      errors: { form: UNREADABLE_FORM },
    });
  });
});

describe("confirmationOn", () => {
  const booked = {
    confirmedOn: "2026-09-03",
    dueDate: "2026-10-01",
    assignee: CONTACT,
  };

  it("keeps the day a booking was confirmed while the booking stands", () => {
    expect(confirmationOn(booked, { ...booked, confirmed: true }, TODAY)).toBe(
      "2026-09-03",
    );
  });

  it("records today for a new day or a new assignee confirmed in the same save", () => {
    expect(
      confirmationOn(
        booked,
        { ...booked, dueDate: "2026-10-08", confirmed: true },
        TODAY,
      ),
    ).toBe(TODAY);
    expect(
      confirmationOn(
        booked,
        { ...booked, assignee: "me", confirmed: true },
        TODAY,
      ),
    ).toBe(TODAY);
  });

  it("records today for a task confirmed for the first time, or a new one", () => {
    const unconfirmed = { ...booked, confirmedOn: null };
    expect(
      confirmationOn(unconfirmed, { ...booked, confirmed: true }, TODAY),
    ).toBe(TODAY);
    expect(confirmationOn(null, { ...booked, confirmed: true }, TODAY)).toBe(
      TODAY,
    );
  });

  it("clears it when unticked, or when there is no day or nobody to book", () => {
    expect(
      confirmationOn(booked, { ...booked, confirmed: false }, TODAY),
    ).toBeNull();
    expect(
      confirmationOn(
        booked,
        { ...booked, dueDate: null, confirmed: true },
        TODAY,
      ),
    ).toBeNull();
    expect(
      confirmationOn(
        booked,
        { ...booked, assignee: NONE, confirmed: true },
        TODAY,
      ),
    ).toBeNull();
  });
});

describe("taskFields", () => {
  it("round-trips a stored task through the form unchanged", () => {
    const stored = {
      title: "Clean the gutters",
      unitId: null,
      notes: "Ladder is in the garage.",
      dueDate: "2026-10-01",
      completedOn: null,
      confirmedOn: "2026-09-03",
      assigneeContactId: CONTACT,
      assigneeKind: "contact" as const,
      priority: "high" as const,
      estCostCents: 18_050,
      actualCostCents: null,
      recurrenceMonths: 3,
      tradeTag: "gutters",
      capitalItemId: ITEM,
    };

    expect(
      validateTask(taskFields(stored, BUILDING), { kind: "open" }),
    ).toMatchObject({
      ok: true,
      values: {
        title: stored.title,
        notes: stored.notes,
        dueDate: stored.dueDate,
        assignee: { kind: "contact", contactId: CONTACT },
        confirmed: true,
        priority: "high",
        estCostCents: 18_050,
        recurrenceMonths: 3,
        tradeTag: "gutters",
        capitalItemId: ITEM,
      },
    });
  });
});

describe("validateCompletion", () => {
  it("records the day it was done and what it cost", () => {
    expect(
      validateCompletion({ completedOn: "2026-09-16", cost: "180" }, TODAY),
    ).toEqual({
      ok: true,
      values: {
        completedOn: "2026-09-16",
        actualCostCents: 18_000,
        recordExpense: false,
      },
    });
  });

  it("records an expense only when asked, and only for a cost above zero", () => {
    const ticked = (cost: string) =>
      validateCompletion(
        { completedOn: "2026-09-16", cost, recordExpense: true },
        TODAY,
      );

    expect(ticked("180")).toMatchObject({ values: { recordExpense: true } });
    expect(ticked("0")).toMatchObject({ values: { recordExpense: false } });
    expect(ticked("")).toMatchObject({ values: { recordExpense: false } });
  });

  it("takes no cost as none recorded, not as free", () => {
    expect(
      validateCompletion({ completedOn: "2026-09-16", cost: "" }, TODAY),
    ).toMatchObject({ ok: true, values: { actualCostCents: null } });
  });

  it("refuses a day not yet reached, and an amount it cannot read", () => {
    expect(
      validateCompletion({ completedOn: "2026-09-17", cost: "abc" }, TODAY),
    ).toEqual({
      ok: false,
      errors: {
        completedOn: "Enter today’s date or an earlier one.",
        cost: "Enter an amount in dollars, like 1,250.",
      },
    });
  });
});
