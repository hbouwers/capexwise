/**
 * `Record replacement`'s rules, once, for both sides of the form
 * (`docs/ui/screens/building-detail.md`, the item editor): the day the new
 * item went in, and what it cost. The browser runs `validateReplacement`
 * before it sends anything and the server action runs it again —
 * `building-form.ts` explains why one function serves both.
 *
 * A replacement is a new row and the old one is marked replaced; nothing here
 * edits an install year (data-model §5).
 */
import { z } from "zod";

import {
  type CalendarDate,
  formatDate,
  isCalendarDate,
  yearOf,
} from "@/lib/dates";
import { amount, type FieldErrors, UNREADABLE_FORM } from "@/lib/forms";
import type { Cents } from "@/lib/money";

/** The form, as typed. */
export type ReplacementFields = { installedOn: string; cost: string };

/** The new item's install, under the columns' Drizzle names. */
export type ReplacementValues = {
  installDate: CalendarDate;
  installYear: number;
  actualCostCents: Cents | null;
};

export type ValidatedReplacement =
  { ok: true; values: ReplacementValues } | { ok: false; errors: FieldErrors };

const shape = z.object({
  installedOn: z.string().max(500),
  cost: z.string().max(500),
});

/**
 * Every rule the form states, or every message at once.
 *
 * - **The date is required.** A replacement is recorded as audited, and an
 *   audited item says when it went in, to the day (ADR-0005).
 * - **It has happened.** `today` is today where the building is, so a date
 *   after it is a typo in the year, most likely — and a replacement not yet
 *   done is a plan, which is #96's to store.
 * - **It is not older than what it replaced** — the old item's install date
 *   when it was audited, its year when it was only estimated. A furnace put in
 *   before the one it replaced is two rows in the wrong order.
 * - **The cost is optional**, as `Confirm`'s is: a replacement under warranty
 *   may have cost nothing, and one whose invoice is lost is still a fact.
 */
export function validateReplacement(
  input: unknown,
  today: CalendarDate,
  replaced: { installYear: number; installDate: CalendarDate | null },
): ValidatedReplacement {
  const parsed = shape.safeParse(input);
  if (!parsed.success) return { ok: false, errors: { form: UNREADABLE_FORM } };

  const fields = parsed.data;
  const errors: FieldErrors = {};

  const date = fields.installedOn.trim();
  if (date === "") {
    errors.installedOn = "Enter the day the new one was installed.";
  } else if (!isCalendarDate(date)) {
    errors.installedOn = "Enter the whole date — day, month and year.";
  } else if (date > today) {
    errors.installedOn = "Enter today’s date or an earlier one.";
  } else if (replaced.installDate !== null && date < replaced.installDate) {
    errors.installedOn = `Enter ${formatDate(replaced.installDate)} or later — the one it replaces went in then.`;
  } else if (yearOf(date) < replaced.installYear) {
    errors.installedOn = `Enter a date in ${replaced.installYear} or later — the one it replaces went in then.`;
  }

  const cost = amount(fields.cost);
  if (cost.state === "bad") errors.cost = cost.message;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    values: {
      installDate: date,
      installYear: yearOf(date),
      actualCostCents: cost.state === "ok" ? cost.cents : null,
    },
  };
}
