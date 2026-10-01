/**
 * A building's gross rent for the statement (`docs/ui/screens/tax-planner.md`,
 * Income statement): **rent received this year to date, plus the expected
 * rent of the months still to come**.
 *
 * The months still to come are the current one, while nobody has marked it,
 * and every month after it to December. An opened month carries its own
 * snapshot of the rent (`docs/data-model.md` §4); a month not yet opened is
 * expected at what each occupied unit's rent is today. A vacant month expects
 * nothing, as on the rent roll (`rentTotals`).
 *
 * **An earlier month nobody marked counts for nothing**, and is counted, so
 * the line can say so. It is not still to come, and the product does not know
 * the rent arrived — only that nobody said it did. Taking it as received would
 * be a figure nobody entered.
 */
import { type CalendarDate, monthOf, yearOf } from "@/lib/dates";
import { type Cents } from "@/lib/money";

export type YearRentPeriod = {
  periodMonth: CalendarDate;
  amountExpectedCents: Cents;
  amountReceivedCents: Cents | null;
  vacant: boolean;
};

export type YearRent = {
  receivedCents: Cents;
  expectedCents: Cents;
  /** Earlier months of the year, opened and never marked. */
  unmarkedPeriods: number;
};

/**
 * @param currentMonth The first of the building's current month, where it is.
 * @param periods The building's periods; those outside `year` are ignored.
 * @param occupiedRentCents The rents of its occupied units today, for the
 *   months not opened yet.
 */
export function yearRent({
  year,
  currentMonth,
  periods,
  occupiedRentCents,
}: {
  year: number;
  currentMonth: CalendarDate;
  periods: readonly YearRentPeriod[];
  occupiedRentCents: readonly Cents[];
}): YearRent {
  const result: YearRent = {
    receivedCents: 0,
    expectedCents: 0,
    unmarkedPeriods: 0,
  };

  for (const period of periods) {
    if (yearOf(period.periodMonth) !== year || period.vacant) continue;

    if (period.amountReceivedCents !== null) {
      result.receivedCents += period.amountReceivedCents;
    } else if (period.periodMonth >= currentMonth) {
      result.expectedCents += period.amountExpectedCents;
    } else {
      result.unmarkedPeriods += 1;
    }
  }

  // The months after the current one, which nobody has opened yet. A year
  // already over has none; a later year, all twelve.
  const thisYear = yearOf(currentMonth);
  const opened = new Set(
    periods
      .filter((period) => yearOf(period.periodMonth) === year)
      .map((period) => period.periodMonth),
  );
  const fromMonth =
    year < thisYear ? 13 : year > thisYear ? 1 : monthOf(currentMonth) + 1;
  const monthlyCents = occupiedRentCents.reduce((sum, rent) => sum + rent, 0);
  for (let month = fromMonth; month <= 12; month += 1) {
    const first = `${year}-${String(month).padStart(2, "0")}-01`;
    // A future month opened early is counted from its own rows above.
    if (!opened.has(first)) result.expectedCents += monthlyCents;
  }

  return result;
}
