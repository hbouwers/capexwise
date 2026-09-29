/**
 * The expense modal's rules, once, for both sides of it
 * (`docs/ui/screens/expenses.md`, the expense modal). The browser runs
 * `validateExpense` before it sends anything and the server action runs it
 * again on whatever arrives — `building-form.ts` explains why one function
 * serves both.
 *
 * Framework-free. It knows the shape of an id and of a category's slug, not
 * which buildings, units, items, contacts or categories exist: those are the
 * action's to refuse.
 */
import { z } from "zod";

import { moneyField } from "@/lib/building-form";
import { type CalendarDate, isCalendarDate, yearOf } from "@/lib/dates";
import {
  asksClassification,
  type Classification,
  CLASSIFICATION_LABELS,
  type Direction,
  directionOf,
  signedAmount,
} from "@/lib/expenses";
import { amount, type FieldErrors, UNREADABLE_FORM } from "@/lib/forms";
import type { Cents } from "@/lib/money";

/**
 * A `Select`'s value for "none of these" — the task form's word, for Radix's
 * reason: it refuses an empty string as an item's value.
 */
export const NONE = "none";

/** The modal's form, as typed and chosen. */
export type ExpenseFields = {
  occurredOn: string;
  /** A positive figure; `direction` says which way it went. */
  amount: string;
  direction: Direction;
  buildingId: string;
  /** `shared`, or a unit of that building. */
  scope: string;
  /** A category's slug, or empty before one is chosen. */
  category: string;
  description: string;
  /** Asked only where `asksClassification` says; empty is unclassified. */
  classification: string;
  /** `none`, or one of the building's capital items. */
  equipment: string;
  /** `none`, or a contact. */
  contact: string;
  /**
   * The task it paid for. Not a field anyone edits: `Mark done` sets it and
   * the modal keeps it, so saving an expense does not unlink its job.
   */
  taskId: string;
};

/** The form, as `transactions` holds it, under its Drizzle names. */
export type ExpenseValues = {
  occurredOn: CalendarDate;
  amountCents: Cents;
  buildingId: string;
  /** Null for the building's own. Still to be found in the building. */
  unitId: string | null;
  scheduleECategory: string;
  description: string | null;
  classification: Classification | null;
  capitalItemId: string | null;
  contactId: string | null;
  taskId: string | null;
};

export type ValidatedExpense =
  { ok: true; values: ExpenseValues } | { ok: false; errors: FieldErrors };

/**
 * Before this, a year is a typo — `<input type="date">` takes 0226 as readily
 * as 2026 — and no receipt from before it is one a Schedule E still needs.
 */
export const EARLIEST_EXPENSE_YEAR = 2000;

/** A line on a ledger, not a paragraph. */
export const DESCRIPTION_MAX = 500;

const shape = z.object({
  occurredOn: z.string().max(100),
  amount: z.string().max(500),
  direction: z.enum(["out", "refund"]),
  buildingId: z.string().max(100),
  scope: z.string().max(100),
  category: z.string().max(100),
  description: z.string().max(5000),
  classification: z.string().max(100),
  equipment: z.string().max(100),
  contact: z.string().max(100),
  taskId: z.string().max(100),
});

const uuid = z.uuid();
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isClassification(value: string): value is Classification {
  return Object.hasOwn(CLASSIFICATION_LABELS, value);
}

/** The message for a date after today where the building is. */
export const FUTURE_DATE = "Enter today’s date or an earlier one.";

/**
 * Every rule the modal states, or every message at once — `building-form.ts`
 * says why never the first one only.
 *
 * - **The date is required, and not after `today`** — today where the
 *   building is. Spend that has not happened is not recorded; a quote is a
 *   task's estimate. `today` is null on the server's first pass, before it
 *   has read which building's zone to judge by, and the action applies
 *   `FUTURE_DATE` itself once it has.
 * - **The amount is required and not zero**, entered without a sign: the
 *   `Money out` / `Refund` choice is the sign.
 * - **A building and a category are required.**
 * - **A classification is stored only where it is asked** — the repairs
 *   category, or spend on a capital item — and an answer left empty there is
 *   `unclassified`. Asked nowhere else, it is stored as null whatever arrived,
 *   so changing a repair's category to utilities drops the question with it.
 */
export function validateExpense(
  input: unknown,
  today: CalendarDate | null,
): ValidatedExpense {
  const parsed = shape.safeParse(input);
  if (!parsed.success) return { ok: false, errors: { form: UNREADABLE_FORM } };

  const fields = parsed.data;
  const errors: FieldErrors = {};

  const occurredOn = fields.occurredOn.trim();
  if (occurredOn === "") {
    errors.occurredOn = "Enter the date on the receipt.";
  } else if (!isCalendarDate(occurredOn)) {
    errors.occurredOn = "Enter the whole date — day, month and year.";
  } else if (yearOf(occurredOn) < EARLIEST_EXPENSE_YEAR) {
    errors.occurredOn = `Enter a date in ${EARLIEST_EXPENSE_YEAR} or later.`;
  } else if (today !== null && occurredOn > today) {
    errors.occurredOn = FUTURE_DATE;
  }

  const money = amount(fields.amount);
  let cents: Cents | null = null;
  if (money.state === "empty") {
    errors.amount = "Enter what it cost.";
  } else if (money.state === "bad") {
    errors.amount = money.message;
  } else if (money.cents === 0) {
    errors.amount = "Enter an amount above zero.";
  } else {
    cents = money.cents;
  }

  if (fields.buildingId === "") {
    errors.buildingId = "Choose the building it was for.";
  } else if (!uuid.safeParse(fields.buildingId).success) {
    return { ok: false, errors: { form: UNREADABLE_FORM } };
  }

  if (fields.category === "") {
    errors.category = "Choose a Schedule E category.";
  } else if (!SLUG.test(fields.category)) {
    return { ok: false, errors: { form: UNREADABLE_FORM } };
  }

  const shared = fields.scope === "shared";
  const ids = [fields.equipment, fields.contact].filter((id) => id !== NONE);
  if (fields.taskId !== "") ids.push(fields.taskId);
  if (!shared) ids.push(fields.scope);
  if (ids.some((id) => !uuid.safeParse(id).success)) {
    return { ok: false, errors: { form: UNREADABLE_FORM } };
  }

  if (
    fields.classification !== "" &&
    !isClassification(fields.classification)
  ) {
    return { ok: false, errors: { form: UNREADABLE_FORM } };
  }

  const description = fields.description.trim();
  if (description.length > DESCRIPTION_MAX) {
    errors.description = `Keep it to ${DESCRIPTION_MAX} characters.`;
  }

  if (Object.keys(errors).length > 0 || cents === null) {
    return { ok: false, errors };
  }

  const capitalItemId = fields.equipment === NONE ? null : fields.equipment;
  const classification = asksClassification(fields.category, capitalItemId)
    ? isClassification(fields.classification)
      ? fields.classification
      : "unclassified"
    : null;

  return {
    ok: true,
    values: {
      occurredOn,
      amountCents: signedAmount(cents, fields.direction),
      buildingId: fields.buildingId,
      unitId: shared ? null : fields.scope,
      scheduleECategory: fields.category,
      description: description === "" ? null : description,
      classification,
      capitalItemId,
      contactId: fields.contact === NONE ? null : fields.contact,
      taskId: fields.taskId === "" ? null : fields.taskId,
    },
  };
}

/**
 * A new expense: dated today, money out, and the page's building and
 * category filled in when it was filtered to one — `?building=…&expense=new`
 * arrives on that building.
 */
export function emptyExpenseFields({
  today,
  buildingId = "",
  category = "",
}: {
  today: CalendarDate;
  buildingId?: string;
  category?: string;
}): ExpenseFields {
  return {
    occurredOn: today,
    amount: "",
    direction: "out",
    buildingId,
    scope: "shared",
    category,
    description: "",
    classification: "",
    equipment: NONE,
    contact: NONE,
    taskId: "",
  };
}

/**
 * `Save and add another` (`expenses.md`): the date, the building and the
 * category stay — the next receipt in the stack is most likely the same
 * day's, for the same building, on the same line — and everything else is
 * cleared.
 */
export function nextExpenseFields(saved: ExpenseFields): ExpenseFields {
  return emptyExpenseFields({
    today: saved.occurredOn,
    buildingId: saved.buildingId,
    category: saved.category,
  });
}

/** The edit form, prefilled from what is stored. */
export function expenseFields(expense: {
  occurredOn: CalendarDate;
  amountCents: Cents;
  buildingId: string;
  unitId: string | null;
  scheduleECategory: string;
  description: string | null;
  classification: Classification | null;
  capitalItemId: string | null;
  contactId: string | null;
  taskId: string | null;
}): ExpenseFields {
  return {
    occurredOn: expense.occurredOn,
    amount: moneyField(Math.abs(expense.amountCents)),
    direction: directionOf(expense.amountCents),
    buildingId: expense.buildingId,
    scope: expense.unitId ?? "shared",
    category: expense.scheduleECategory,
    description: expense.description ?? "",
    classification: expense.classification ?? "",
    equipment: expense.capitalItemId ?? NONE,
    contact: expense.contactId ?? NONE,
    taskId: expense.taskId ?? "",
  };
}
