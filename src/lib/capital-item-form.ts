/**
 * The two forms that say when an item went in and what it cost, once, for
 * both sides of each (`docs/ui/screens/building-detail.md`, Equipment &
 * capital items): `Confirm`, which turns an estimated item into an audited
 * one, and the item editor's `Record replacement`. The browser runs the
 * validator before it sends anything and the server action runs it again —
 * `building-form.ts` explains why one function serves both.
 *
 * A replacement is a new row and the old one is marked replaced; nothing here
 * edits an install year that stays in service (data-model §5).
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

/** Either form, as typed. */
export type InstallFields = { installedOn: string; cost: string };

/** The install, under the columns' Drizzle names. */
export type InstallValues = {
  installDate: CalendarDate;
  installYear: number;
  actualCostCents: Cents | null;
};

export type ValidatedInstall =
  { ok: true; values: InstallValues } | { ok: false; errors: FieldErrors };

const shape = z.object({
  installedOn: z.string().max(500),
  cost: z.string().max(500),
});

/** The earliest install year `capital_items_install_year_plausible` allows. */
const EARLIEST_YEAR = 1600;

/**
 * The rules both forms share, with the date's message for a date that is
 * missing, and a further rule for the date when there is one. `null` from
 * `laterThan` is a date that passes it.
 */
function validateInstall(
  input: unknown,
  today: CalendarDate,
  missing: string,
  laterThan: (date: CalendarDate) => string | null,
): ValidatedInstall {
  const parsed = shape.safeParse(input);
  if (!parsed.success) return { ok: false, errors: { form: UNREADABLE_FORM } };

  const fields = parsed.data;
  const errors: FieldErrors = {};

  const date = fields.installedOn.trim();
  if (date === "") {
    errors.installedOn = missing;
  } else if (!isCalendarDate(date)) {
    errors.installedOn = "Enter the whole date — day, month and year.";
  } else if (date > today) {
    errors.installedOn = "Enter today’s date or an earlier one.";
  } else if (yearOf(date) < EARLIEST_YEAR) {
    errors.installedOn = `Enter a date in ${EARLIEST_YEAR} or later.`;
  } else {
    const message = laterThan(date);
    if (message !== null) errors.installedOn = message;
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

/**
 * `Confirm`: the day the item actually went in, and what it cost — PRD F2's
 * prompt, and what the schema asks of an audited item.
 *
 * - **The date is required**, and replaces the estimated year: the estimate
 *   was a guess at this date, so an estimate of 2014 confirmed as March 2011
 *   is an item installed in 2011 (ADR-0005).
 * - **It has happened** — today where the building is, as the replacement's.
 * - **The cost is optional**, and it is what the item did cost — the tax
 *   basis, `actual_cost_cents` — not what replacing it will. Somebody reading
 *   a label rarely has the invoice.
 */
export function validateConfirmation(
  input: unknown,
  today: CalendarDate,
): ValidatedInstall {
  return validateInstall(
    input,
    today,
    "Enter the day it was installed.",
    () => null,
  );
}

/**
 * `Record replacement`: every rule `Confirm` has, and one more.
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
): ValidatedInstall {
  return validateInstall(
    input,
    today,
    "Enter the day the new one was installed.",
    (date) => {
      if (replaced.installDate !== null && date < replaced.installDate) {
        return `Enter ${formatDate(replaced.installDate)} or later — the one it replaces went in then.`;
      }
      if (yearOf(date) < replaced.installYear) {
        return `Enter a date in ${replaced.installYear} or later — the one it replaces went in then.`;
      }
      return null;
    },
  );
}
