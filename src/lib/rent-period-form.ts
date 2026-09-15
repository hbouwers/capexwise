/**
 * The Other amount form's rules, once, for both sides of it
 * (`docs/ui/screens/building-detail.md`, Units & rent): what arrived, when,
 * what was expected, a note, and whether the unit stood empty that month.
 * The browser runs `validateRentPeriod` before it sends anything and the
 * server action runs it again — `building-form.ts` explains why one function
 * serves both.
 *
 * The same form records rent for a unit with no period that month, where the
 * expected amount is typed rather than snapshotted (data-model §4, #97).
 */
import { z } from "zod";

import { moneyField } from "@/lib/building-form";
import { type CalendarDate, isCalendarDate } from "@/lib/dates";
import { amount, type FieldErrors, UNREADABLE_FORM } from "@/lib/forms";
import type { Cents } from "@/lib/money";
import { paidOn } from "@/lib/rent";

/** The form, as typed. */
export type RentPeriodFields = {
  expected: string;
  received: string;
  receivedOn: string;
  note: string;
  vacant: boolean;
};

/** The form as `rent_periods` holds it, under the columns' Drizzle names. */
export type RentPeriodValues = {
  amountExpectedCents: Cents;
  amountReceivedCents: Cents | null;
  receivedOn: CalendarDate | null;
  note: string | null;
  vacant: boolean;
};

export type ValidatedRentPeriod =
  { ok: true; values: RentPeriodValues } | { ok: false; errors: FieldErrors };

const line = z.string().max(500);

const shape = z.object({
  expected: line,
  received: line,
  receivedOn: line,
  note: z.string().max(2000),
  vacant: z.boolean(),
});

/**
 * Every rule the form states, or every message at once.
 *
 * - **A vacant month holds no money**, so a vacant submission's amount and
 *   date are dropped rather than refused: the form hides them when the box is
 *   ticked, and what was typed before it was is not a payment.
 * - **The date only means something beside an amount.** It is prefilled
 *   whether or not anything arrived, so a form opened to correct the expected
 *   amount does not have to clear a date nobody typed.
 * - **Nothing received is an empty field, not `$0`.** A zero would put a
 *   payment on the row that says none arrived — the false zero data-model §4
 *   keeps out of the totals.
 * - **A payment has already arrived.** `today` is today where the building
 *   is, so a date after it is a typo in the year, most likely.
 */
export function validateRentPeriod(
  input: unknown,
  today: CalendarDate,
): ValidatedRentPeriod {
  const parsed = shape.safeParse(input);
  if (!parsed.success) return { ok: false, errors: { form: UNREADABLE_FORM } };

  const fields = parsed.data;
  const errors: FieldErrors = {};

  const expected = amount(fields.expected);
  if (expected.state === "empty") {
    errors.expected = "Enter the rent expected for the month.";
  } else if (expected.state === "bad") {
    errors.expected = expected.message;
  }

  let amountReceivedCents: Cents | null = null;
  let receivedOn: CalendarDate | null = null;

  if (!fields.vacant) {
    const received = amount(fields.received);

    if (received.state === "bad") {
      errors.received = received.message;
    } else if (received.state === "ok" && received.cents === 0) {
      errors.received = "Leave it empty if nothing arrived.";
    } else if (received.state === "ok") {
      amountReceivedCents = received.cents;

      const date = fields.receivedOn.trim();
      if (date === "") {
        errors.receivedOn = "Enter the day it arrived.";
      } else if (!isCalendarDate(date)) {
        errors.receivedOn = "Enter the whole date — day, month and year.";
      } else if (date > today) {
        errors.receivedOn = "Enter today’s date or an earlier one.";
      } else {
        receivedOn = date;
      }
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const note = fields.note.trim();

  return {
    ok: true,
    values: {
      amountExpectedCents: expected.state === "ok" ? expected.cents : 0,
      amountReceivedCents,
      receivedOn,
      note: note === "" ? null : note,
      vacant: fields.vacant,
    },
  };
}

/**
 * The form for a period, prefilled from what is stored. With nothing received
 * yet, the date is the one `Mark paid` would record, so a partial payment
 * typed on the day it arrives needs only its amount.
 */
export function rentPeriodFields(
  period: {
    periodMonth: CalendarDate;
    amountExpectedCents: Cents;
    amountReceivedCents: Cents | null;
    receivedOn: CalendarDate | null;
    note: string | null;
    vacant: boolean;
  },
  today: CalendarDate,
): RentPeriodFields {
  return {
    expected: moneyField(period.amountExpectedCents),
    received: moneyField(period.amountReceivedCents),
    receivedOn: period.receivedOn ?? paidOn(period.periodMonth, today),
    note: period.note ?? "",
    vacant: period.vacant,
  };
}

/**
 * `Record rent`, for a unit with no period that month: the expected amount
 * starts at the unit's rent as it is today, if it has one — a vacant unit's
 * asking rent, which the person corrects to what the month was let for.
 */
export function newRentPeriodFields(
  month: CalendarDate,
  rentCents: Cents | null,
  today: CalendarDate,
): RentPeriodFields {
  return {
    expected: moneyField(rentCents),
    received: "",
    receivedOn: paidOn(month, today),
    note: "",
    vacant: false,
  };
}
