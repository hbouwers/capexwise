/**
 * The calendar side of ADR-0005. It names four kinds of date and gives each its
 * own column type; the two this file serves are the ones without a clock:
 *
 * - a **date** — a task's due date, a rent period, the reserve's as-of date —
 *   which is a day on a calendar and nothing more;
 * - a **year** — a capital item's install year, usually a guess, stored as an
 *   integer and never widened to a date.
 *
 * The fourth kind, a moment something happened, is a `timestamptz` and a
 * JavaScript `Date`, and needs nothing here beyond `todayIn` turning one into
 * the day it fell on at a building.
 *
 * **A date never gets a clock time.** It stays a `YYYY-MM-DD` string from the
 * column to the page, which is how Drizzle reads a `date` column. Passing one
 * through `new Date()` gives it a midnight in some timezone, and in every other
 * timezone it is a day early or late.
 */

/** `YYYY-MM-DD`: a day on a calendar, with no clock time and no timezone. */
export type CalendarDate = string;

const SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real day, not only the right shape: `2026-02-29` is not one. */
export function isCalendarDate(value: string): value is CalendarDate {
  const match = SHAPE.exec(value);
  if (!match) return false;

  const month = Number(match[2]);
  const day = Number(match[3]);

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysIn(Number(match[1]), month)
  );
}

function daysIn(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parts(date: CalendarDate): {
  year: number;
  month: number;
  day: number;
} {
  if (!isCalendarDate(date)) {
    throw new RangeError(
      `Expected a date as YYYY-MM-DD, got ${JSON.stringify(date)}.`,
    );
  }

  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return { year, month, day };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Today where the building is, not where the viewer is (ADR-0005). "Due
 * today" means today at the gutters. The owner and the buildings share a zone
 * today, which is an accident of this portfolio rather than a rule.
 *
 * `timeZone` is the building's IANA name. An unknown one throws: a building
 * whose clock cannot be read cannot say what is due, and guessing the
 * server's would be wrong without saying so.
 *
 * `now` is a parameter so that a caller evaluating many buildings uses one
 * instant for all of them, and so the tests can pick it.
 */
export function todayIn(
  timeZone: string,
  now: Date = new Date(),
): CalendarDate {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, format);
  }

  // Read by part rather than by position, so the locale's field order and
  // separators never matter.
  const field = Object.fromEntries(
    format.formatToParts(now).map((p) => [p.type, p.value]),
  );

  return `${field.year}-${field.month}-${field.day}`;
}

/**
 * Whether `name` is a timezone this runtime can read — the check a
 * building's `timezone` passes before it is stored, because `todayIn` throws
 * on one it cannot. Asked of `Intl` itself rather than of a list, so it agrees
 * with `todayIn` by construction: an alias such as `US/Eastern` is accepted
 * here exactly when it would work there.
 */
export function isTimeZone(name: string): boolean {
  if (name.trim() === "") return false;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/**
 * The first of the date's month — the only day a rent period may fall on, and
 * `rent_periods.period_month` carries a check constraint saying so
 * (`docs/data-model.md` §4).
 */
export function firstOfMonth(date: CalendarDate): CalendarDate {
  parts(date);

  return `${date.slice(0, 7)}-01`;
}

/**
 * The first of the month `months` away from the date's — negative for
 * earlier. The rent roll's month switcher steps by it. Whole months on the
 * calendar, never a number of days, so the 31st of a month is never a problem
 * it has to solve.
 */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  if (!Number.isSafeInteger(months)) {
    throw new RangeError(`Expected a whole number of months, got ${months}.`);
  }

  const { year, month } = parts(date);
  const index = year * 12 + (month - 1) + months;
  const shifted = String((index % 12) + 1).padStart(2, "0");

  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${shifted}-01`;
}

/** The year a date falls in: the forecast's "this year", from `todayIn`. */
export function yearOf(date: CalendarDate): number {
  return parts(date).year;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * - `full`: `Sep 14, 2026`. The default.
 * - `short`: `Sep 14`, for a column of near dates where the year is plain from
 *   the page — a task list, a rent period's paid date.
 * - `month`: `Sep 2026`.
 * - `month-long`: `September 2026`, for a month that is the subject of the
 *   page rather than a value in a column — the rent roll's month switcher.
 * - `month-name`: `September`, where the year is plain from the sentence.
 */
export type DateForm = "full" | "short" | "month" | "month-long" | "month-name";

/**
 * Always absolute: every date on this product is a planning date, so "3 days
 * ago" is never the date. Lateness and time-to-due sit *beside* it
 * (`docs/ui/screens/README.md`, Dates).
 *
 * The month names are spelled out here rather than taken from `Intl`, whose
 * abbreviations come from the runtime's locale data and have changed between
 * versions — British English's `Sep` became `Sept` — and a date has to read the
 * same from the server as from any browser.
 */
export function formatDate(
  date: CalendarDate,
  form: DateForm = "full",
): string {
  const { year, month, day } = parts(date);
  const name = MONTHS[month - 1];

  if (form === "month") return `${name} ${year}`;
  if (form === "month-long") return `${MONTH_NAMES[month - 1]} ${year}`;
  if (form === "month-name") return MONTH_NAMES[month - 1]!;
  if (form === "short") return `${name} ${day}`;
  return `${name} ${day}, ${year}`;
}
