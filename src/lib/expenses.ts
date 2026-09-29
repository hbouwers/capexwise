/**
 * The expenses page's rules (`docs/ui/screens/expenses.md`): which period the
 * page shows and how far back it reaches, what the three tiles add up, and
 * which expenses are asked the repair-or-improvement question. Framework-free,
 * like the rest of `src/lib` — calendar dates and integer cents in, the same
 * out — so the unit suite holds each rule to its words.
 *
 * `transactions` (`docs/data-model.md` §6) is the table these rules read.
 * Its amount is **signed** — negative is money out, positive a refund — and
 * every figure here that says "spent" is the other way up: what went out, net
 * of what came back.
 */
import {
  addMonths,
  type CalendarDate,
  firstOfMonth,
  formatDate,
  yearOf,
} from "@/lib/dates";
import type { Cents } from "@/lib/money";
import { BACK_FILL_MONTHS, chooseMonth, type MonthRange } from "@/lib/rent";

/**
 * The period the page shows: one month, or the whole of a year — `This year`
 * in the switcher, the tax planner's view of spend.
 */
export type ExpensePeriod =
  { kind: "month"; month: CalendarDate } | { kind: "year"; year: number };

/** `?month=year`: the switcher's `This year`. */
export const THIS_YEAR = "year";

/**
 * The months the switcher reaches: the rent roll's two years back, or further
 * when something older has been recorded — a receipt from three years ago is
 * still on the page it was entered from. It stops at the current month:
 * nothing is recorded in the future (`expense-form.ts`).
 *
 * `today` is the page's day, the latest of its buildings' (`forecastToday`).
 */
export function expenseMonths(
  today: CalendarDate,
  earliestRecorded: CalendarDate | null,
): MonthRange {
  const current = firstOfMonth(today);
  const backFill = addMonths(current, -BACK_FILL_MONTHS);
  const recorded =
    earliestRecorded === null ? null : firstOfMonth(earliestRecorded);

  const earliest =
    recorded !== null && recorded < backFill ? recorded : backFill;

  return { earliest, current };
}

/**
 * The period a `?month=` param asks for: `year` for this year, a month inside
 * the range, or the current month for anything else — `chooseMonth`'s rule,
 * so an old bookmark lands on the earliest month rather than on an error.
 */
export function choosePeriod(
  requested: unknown,
  range: MonthRange,
): ExpensePeriod {
  if (requested === THIS_YEAR) {
    return { kind: "year", year: yearOf(range.current) };
  }

  return { kind: "month", month: chooseMonth(requested, range) };
}

/**
 * The period's days, `from` inclusive and `until` exclusive — the first of
 * the month after, or the January after — so a query can say
 * `occurred_on >= from and occurred_on < until` with no last-day arithmetic.
 */
export function periodBounds(period: ExpensePeriod): {
  from: CalendarDate;
  until: CalendarDate;
} {
  if (period.kind === "month") {
    return { from: period.month, until: addMonths(period.month, 1) };
  }

  return { from: `${period.year}-01-01`, until: `${period.year + 1}-01-01` };
}

/**
 * The year the period is in, from January through the period's last month:
 * the Cash flow tile's year-to-date half. For a month in a year already over,
 * it stops at that month, so "to date" means to the month being looked at.
 */
export function yearThroughPeriod(period: ExpensePeriod): {
  from: CalendarDate;
  until: CalendarDate;
} {
  if (period.kind === "year") return periodBounds(period);

  return {
    from: `${yearOf(period.month)}-01-01`,
    until: addMonths(period.month, 1),
  };
}

/**
 * The `?month=` value for a period: `2026-09`, `year`, or null for the current
 * month — the page without a param, so the link most people follow is the one
 * they would have typed.
 */
export function periodParam(
  period: ExpensePeriod,
  range: MonthRange,
): string | null {
  if (period.kind === "year") return THIS_YEAR;
  if (period.month === range.current) return null;

  return period.month.slice(0, 7);
}

/** `September 2026`, or `2026` for the year. */
export function periodLabel(period: ExpensePeriod): string {
  return period.kind === "year"
    ? String(period.year)
    : formatDate(period.month, "month-long");
}

/**
 * `Jan–Sep`, the months the year-to-date figure covers, or `Jan` alone in
 * January. For the year view, the months so far, through the current one.
 */
export function yearToDateLabel(
  period: ExpensePeriod,
  range: MonthRange,
): string {
  const last =
    period.kind === "month"
      ? period.month
      : yearOf(range.current) === period.year
        ? range.current
        : `${period.year}-12-01`;

  const end = formatDate(last, "short").slice(0, 3);

  return end === "Jan" ? "Jan" : `Jan–${end}`;
}

/** What the modal's `Money out` / `Refund` choice stores. */
export type Direction = "out" | "refund";

/**
 * A magnitude as typed, stored signed: money out is negative (§6). The form
 * refuses zero and a minus sign, so `cents` is always positive here.
 */
export function signedAmount(cents: Cents, direction: Direction): Cents {
  return direction === "out" ? -cents : cents;
}

/** The choice a stored amount was entered with. */
export function directionOf(amountCents: Cents): Direction {
  return amountCents < 0 ? "out" : "refund";
}

/**
 * The Spent tile, and a ledger's foot row turned the right way up: money out
 * net of refunds, as a positive figure, and how many expenses it is. A period
 * of refunds alone spends a negative amount, which is what happened.
 */
export function spendTotals(rows: readonly { amountCents: Cents }[]): {
  spentCents: Cents;
  count: number;
} {
  let net = 0;
  for (const row of rows) net += row.amountCents;

  // `-0` renders the same as `0` and compares unequal to it in a test.
  return { spentCents: net === 0 ? 0 : -net, count: rows.length };
}

/**
 * The category the tax planner asks the repair-or-improvement question of: a
 * repair on the form is only a repair if the work did not improve the
 * property, and a CPA wants that answered for every one (`expenses.md`).
 */
export const REPAIRS = "repairs";

/**
 * Whether an expense carries a classification: one in the repairs category,
 * and any spend on a capital item, which is capital work whatever line it was
 * filed under (`expenses.md`, the modal). Every other expense is deducted
 * where it was filed and has nothing to classify, so it stores none.
 */
export function asksClassification(
  category: string,
  capitalItemId: string | null,
): boolean {
  return category === REPAIRS || capitalItemId !== null;
}

/** The labels the ledger and the modal share. */
export const CLASSIFICATION_LABELS = {
  repair: "Repair",
  improvement: "Improvement",
  unclassified: "Unclassified",
} as const;

export type Classification = keyof typeof CLASSIFICATION_LABELS;

/**
 * The category `Mark done` files a task's expense under, from the task's
 * trade: upkeep that is not a repair — mowing, snow, pest control, a
 * turnover clean, a chimney sweep — is line 7's cleaning and maintenance, a
 * professional's bill is theirs, and everything else, a job with no trade
 * included, is a repair. A default, not a ruling: the expense is one click
 * from the task's toast, and the category is the first thing on its form.
 */
export function categoryForTrade(trade: string | null): string {
  switch (trade) {
    case "landscaper":
    case "snow-removal":
    case "pest-control":
    case "turnover-cleaner":
    case "chimney":
      return "cleaning";
    case "cpa":
    case "attorney":
    case "inspector":
      return "professional-fees";
    case "property-manager":
      return "management-fees";
    case "realtor":
      return "commissions";
    default:
      return REPAIRS;
  }
}

/** What the page's URL carries: the period, the two filters, the modal. */
export type ExpensesView = {
  /** `?month=`, already chosen: `2026-09`, `year`, or null for this month. */
  month: string | null;
  building: string | null;
  category: string | null;
  /** `?expense=`: `new`, an id, or null for no modal. */
  expense: string | null;
};

/**
 * The page's URL for a view, params in a fixed order so the same view is
 * always the same URL.
 */
export function expensesHref(view: ExpensesView): string {
  const params = new URLSearchParams();
  if (view.month) params.set("month", view.month);
  if (view.building) params.set("building", view.building);
  if (view.category) params.set("category", view.category);
  if (view.expense) params.set("expense", view.expense);

  const query = params.toString();
  return query ? `/expenses?${query}` : "/expenses";
}
