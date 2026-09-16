/**
 * `Update reserve` (`docs/ui/screens/capex-forecast.md`, Reserve projection):
 * the balance, the day it was read, and the monthly contribution, for both
 * sides of the form — `building-form.ts` explains why one function serves the
 * browser and the server action.
 *
 * **All three or none**, because the schema stores a reserve whole
 * (`organizations_reserve_all_or_none`, #92): a balance with no date cannot be
 * told apart from a stale one, and a balance with no contribution cannot be
 * projected.
 */
import { z } from "zod";

import { type CalendarDate, isCalendarDate } from "@/lib/dates";
import { amount, type FieldErrors, UNREADABLE_FORM } from "@/lib/forms";
import type { Cents } from "@/lib/money";

/** The form, as typed. */
export type ReserveFields = {
  balance: string;
  asOf: string;
  contribution: string;
};

/** The reserve, under the columns' Drizzle names. */
export type ReserveValues = {
  reserveBalanceCents: Cents;
  reserveAsOf: CalendarDate;
  reserveMonthlyContributionCents: Cents;
};

export type ValidatedReserve =
  { ok: true; values: ReserveValues } | { ok: false; errors: FieldErrors };

const shape = z.object({
  balance: z.string().max(500),
  asOf: z.string().max(500),
  contribution: z.string().max(500),
});

/**
 * - **Every field is required.** `$0` is an amount — an empty reserve, or
 *   nothing added each month, is a fact the projection can use.
 * - **The balance has been read.** `today` is the forecast's today, so a date
 *   after it is a typo, and the projection would start from a balance nobody
 *   has seen yet.
 */
export function validateReserve(
  input: unknown,
  today: CalendarDate,
): ValidatedReserve {
  const parsed = shape.safeParse(input);
  if (!parsed.success) return { ok: false, errors: { form: UNREADABLE_FORM } };

  const fields = parsed.data;
  const errors: FieldErrors = {};

  const balance = amount(fields.balance);
  if (balance.state === "empty") {
    errors.balance = "Enter what the reserve holds — $0 if it is empty.";
  } else if (balance.state === "bad") {
    errors.balance = balance.message;
  }

  const asOf = fields.asOf.trim();
  if (asOf === "") {
    errors.asOf = "Enter the day you read the balance.";
  } else if (!isCalendarDate(asOf)) {
    errors.asOf = "Enter the whole date — day, month and year.";
  } else if (asOf > today) {
    errors.asOf = "Enter today’s date or an earlier one.";
  }

  const contribution = amount(fields.contribution);
  if (contribution.state === "empty") {
    errors.contribution = "Enter what you add each month — $0 if nothing.";
  } else if (contribution.state === "bad") {
    errors.contribution = contribution.message;
  }

  if (
    Object.keys(errors).length > 0 ||
    balance.state !== "ok" ||
    contribution.state !== "ok"
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    values: {
      reserveBalanceCents: balance.cents,
      reserveAsOf: asOf,
      reserveMonthlyContributionCents: contribution.cents,
    },
  };
}
