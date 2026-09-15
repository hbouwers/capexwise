/**
 * The rent roll's rules (`docs/ui/screens/building-detail.md`, Units & rent):
 * which months it reaches, what state a month is in, when a one-click payment
 * is dated, and what the footer adds up. Framework-free, like the rest of
 * `src/lib` — calendar dates and integer cents in, the same out — so the unit
 * suite holds each rule to its words.
 *
 * `docs/data-model.md` §4 is the table these rules read.
 */
import {
  addMonths,
  type CalendarDate,
  firstOfMonth,
  formatDate,
  isCalendarDate,
  yearOf,
} from "@/lib/dates";
import type { Cents } from "@/lib/money";

/**
 * How far back the month switcher goes when the building's acquisition date
 * is not entered: two years, so last year can be back-filled for the tax
 * planner whenever in this year somebody gets round to it.
 */
export const BACK_FILL_MONTHS = 24;

/** The months the rent roll can show: `earliest` to `current`, both firsts. */
export type MonthRange = { earliest: CalendarDate; current: CalendarDate };

/**
 * The switcher's reach. It **stops at the current month** — periods open on
 * first view, and a future month viewed today would snapshot today's rent
 * into it (data-model §4). It goes back to the month the building was
 * acquired, or `BACK_FILL_MONTHS` when that is not entered.
 *
 * `today` is today where the building is (ADR-0005). An acquisition dated in
 * the future — a closing not yet held — reaches no further back than now.
 */
export function rentRollMonths(
  today: CalendarDate,
  acquiredOn: CalendarDate | null,
): MonthRange {
  const current = firstOfMonth(today);
  const earliest =
    acquiredOn === null
      ? addMonths(current, -BACK_FILL_MONTHS)
      : firstOfMonth(acquiredOn);

  return { earliest: earliest < current ? earliest : current, current };
}

const MONTH_PARAM = /^\d{4}-\d{2}$/;

/** `2026-09-01` as the `?month=` param: `2026-09`. */
export function monthParam(month: CalendarDate): string {
  return month.slice(0, 7);
}

/**
 * The month a `?month=` param asks for, inside the range — or the current
 * month, for no param, one that is not a month, or an array of them. A month
 * outside the range is the nearest end of it, so an old bookmark lands on the
 * earliest month rather than on an error.
 *
 * `unknown`, because it comes from a URL.
 */
export function chooseMonth(
  requested: unknown,
  range: MonthRange,
): CalendarDate {
  if (typeof requested !== "string" || !MONTH_PARAM.test(requested)) {
    return range.current;
  }

  const month = `${requested}-01`;
  if (!isCalendarDate(month)) return range.current;

  if (month > range.current) return range.current;
  if (month < range.earliest) return range.earliest;
  return month;
}

/**
 * The date a one-click `Mark paid` records: today, where the building is, for
 * the current month, and **the period's first day for any other** — because
 * back-filling January in September should not record January's rent as
 * having arrived in September (`screens/README.md`, rules to test).
 */
export function paidOn(
  periodMonth: CalendarDate,
  today: CalendarDate,
): CalendarDate {
  return firstOfMonth(today) === periodMonth ? today : periodMonth;
}

/** What a rent period says, as the rent roll's four row states and vacancy. */
export type RentState = "vacant" | "not-marked" | "paid" | "partial" | "over";

type Period = {
  amountExpectedCents: Cents;
  amountReceivedCents: Cents | null;
  vacant: boolean;
};

/**
 * **Not marked, never "unpaid"**: the product does not know the rent did not
 * arrive, only that nobody said it did. A payment is `paid` when it is the
 * expected amount exactly, `partial` below it and `over` above it.
 */
export function rentState(period: Period): RentState {
  if (period.vacant) return "vacant";
  if (period.amountReceivedCents === null) return "not-marked";
  if (period.amountReceivedCents < period.amountExpectedCents) return "partial";
  if (period.amountReceivedCents > period.amountExpectedCents) return "over";
  return "paid";
}

/**
 * The footer's two figures: expected and received over the month's periods.
 * **A vacant month counts in neither** (#97) — it expects nothing, and keeping
 * its snapshot in the expected half would say the building was owed rent for
 * a unit nobody lived in.
 */
export function rentTotals(periods: readonly Period[]): {
  expectedCents: Cents;
  receivedCents: Cents;
} {
  let expectedCents = 0;
  let receivedCents = 0;

  for (const period of periods) {
    if (period.vacant) continue;

    expectedCents += period.amountExpectedCents;
    receivedCents += period.amountReceivedCents ?? 0;
  }

  return { expectedCents, receivedCents };
}

/**
 * `August has 1 unit not marked` — the line under the current month's rent
 * roll for each earlier month somebody opened and nobody finished. The year is
 * named only when it is not the current month's, where `August` alone would
 * be the wrong one.
 */
export function unmarkedLine(
  month: CalendarDate,
  count: number,
  current: CalendarDate,
): string {
  const name = formatDate(
    month,
    yearOf(month) === yearOf(current) ? "month-name" : "month-long",
  );

  return `${name} has ${count} ${count === 1 ? "unit" : "units"} not marked`;
}
