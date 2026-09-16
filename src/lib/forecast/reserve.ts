/**
 * The org's reserve projected across the ten years
 * (`docs/ui/screens/capex-forecast.md`, Reserve projection), and the monthly
 * contribution it would take to never run short.
 *
 * The reserve is kept by the month and a replacement is known only by the
 * year, so two timing rules decide every figure here. Both were settled on
 * 2026-09-16 (#124) toward the reading that never overstates what the reserve
 * covers:
 *
 * - **A replacement is paid in January of its year, before that January's
 *   contribution.** This year's replacements, past-due ones included, come out
 *   of the balance at the start.
 * - **Contributions since the balance's as-of date are not counted.** The
 *   projection starts from the balance as entered, and the first contribution
 *   is the month after this one. The as-of date is shown, never computed with.
 *
 * Contributions only ever add, so within a year the balance is lowest just
 * after its January payment. That is the one balance per year this computes,
 * and the only one a shortfall can show up in.
 */
import { type Cents } from "@/lib/money";

import { ceilDivide, type YearOutflow } from "@/lib/forecast/outflow";

/** The three columns on `organizations`, entered whole (#92). */
export type Reserve = {
  balanceCents: Cents;
  monthlyContributionCents: Cents;
};

export type ReserveYear = {
  year: number;
  /** Every contribution counted before this year's January payment. */
  contributionsCents: Cents;
  /** Every replacement through this year's, this one included. */
  replacementsCents: Cents;
  /** The balance just after this year's replacements are paid. */
  balanceCents: Cents;
  /** Whether that balance is below zero: a `Reserve runs short` bar. */
  short: boolean;
};

export type ReserveProjection = {
  /** The balance as entered, which is where the projection starts. */
  balanceCents: Cents;
  years: ReserveYear[];
  /**
   * The rail's low point: the year the balance is lowest, the earliest when
   * two tie. Its balance is `balanceCents + contributionsCents −
   * replacementsCents`, so the card's four lines add up.
   */
  lowest: ReserveYear;
  /** The years the chart marks as running short, in order. */
  shortYears: number[];
};

/**
 * How many contributions land before January of `year`, for a projection
 * starting in `thisMonth` of `thisYear`: the rest of this year's months, then
 * twelve for each whole year between. None before this year's own payment,
 * and none before next year's when this month is December.
 */
export function contributionsBefore(
  year: number,
  thisYear: number,
  thisMonth: number,
): number {
  if (!Number.isSafeInteger(thisMonth) || thisMonth < 1 || thisMonth > 12) {
    throw new RangeError(`Expected a month from 1 to 12, got ${thisMonth}.`);
  }
  if (year <= thisYear) return 0;

  return 12 - thisMonth + 12 * (year - thisYear - 1);
}

/** The reserve through the ten years of `outflowByYear`, from `thisMonth`. */
export function projectReserve(
  years: readonly YearOutflow[],
  reserve: Reserve,
  thisMonth: number,
): ReserveProjection {
  assertReserve(reserve);
  const first = firstYear(years);

  let replacementsCents = 0;
  const projected = years.map((bar): ReserveYear => {
    replacementsCents += bar.totalCents;
    const contributionsCents =
      reserve.monthlyContributionCents *
      contributionsBefore(bar.year, first, thisMonth);
    const balanceCents =
      reserve.balanceCents + contributionsCents - replacementsCents;

    return {
      year: bar.year,
      contributionsCents,
      replacementsCents,
      balanceCents,
      short: balanceCents < 0,
    };
  });

  const lowest = projected.reduce((low, year) =>
    year.balanceCents < low.balanceCents ? year : low,
  );

  return {
    balanceCents: reserve.balanceCents,
    years: projected,
    lowest,
    shortYears: projected.filter((year) => year.short).map((y) => y.year),
  };
}

/**
 * **`Reserve needed / mo`**: the smallest level monthly contribution, in whole
 * cents, that keeps the balance at or above zero in every one of the ten
 * years, from `balanceCents`.
 *
 * Each year asks for `⌈(replacements through it − balance) ÷ contributions
 * before it⌉`, and the need is the largest of those asks, never below zero.
 *
 * **A year no contribution reaches is left out of the asking.** This year's
 * payment comes before any contribution, and so does next year's when this
 * month is December. If the balance cannot cover those, nothing saved from
 * now on can — the projection shows that year short whatever is contributed —
 * so the need is what brings the reserve back to zero by the first January a
 * contribution does reach, and keeps it there. Carrying the shortfall forward
 * is what makes it pay that back.
 */
export function reserveNeededPerMonthCents(
  years: readonly YearOutflow[],
  balanceCents: Cents,
  thisMonth: number,
): Cents {
  assertCents(balanceCents, "balance");
  const first = firstYear(years);

  let replacementsCents = 0;
  let needed = 0;

  for (const bar of years) {
    replacementsCents += bar.totalCents;

    const months = contributionsBefore(bar.year, first, thisMonth);
    const shortfall = replacementsCents - balanceCents;
    if (months === 0 || shortfall <= 0) continue;

    needed = Math.max(needed, ceilDivide(shortfall, months));
  }

  return needed;
}

function firstYear(years: readonly YearOutflow[]): number {
  const first = years[0];
  if (!first) throw new RangeError("Expected the forecast's years, got none.");

  return first.year;
}

function assertReserve(reserve: Reserve): void {
  assertCents(reserve.balanceCents, "balance");
  assertCents(reserve.monthlyContributionCents, "monthly contribution");
}

/** The schema holds both to whole, non-negative cents; so does this. */
function assertCents(cents: number, name: string): void {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError(
      `Expected the reserve's ${name} in whole, non-negative cents, got ${cents}.`,
    );
  }
}
