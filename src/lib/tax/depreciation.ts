/**
 * Straight-line depreciation, the one recovery method PRD F4 asks for, over
 * the two recovery periods #144 settled (`docs/ui/screens/tax-planner.md`):
 *
 * - **Residential rental property, 27.5 years, mid-month.** A building, and
 *   every improvement that is part of its structure — a roof, a furnace, a
 *   water heater, wiring.
 * - **Five-year property, half-year.** The appliances and the carpet: a
 *   dryer is not recovered over 27.5 years.
 *
 * Integer cents throughout. A year's depreciation is the difference between
 * two cumulative figures, each rounded once, so the years of a schedule sum to
 * its basis exactly — the forecast's rule that a total never disagrees with
 * its own parts (ADR-0005).
 *
 * **What this does not model**, and says so rather than approximating: the
 * mid-quarter convention, which replaces half-year when more than 40% of a
 * year's five-year property is placed in service in its last quarter; MACRS's
 * default 200% declining balance for five-year property, of which straight
 * line is the elected alternative; bonus depreciation and cost segregation,
 * which PRD F4 defers to v1.1; and the year of a sale, which is #43's.
 */
import { type Cents } from "@/lib/money";

/** Which of the two schedules an asset is recovered over. */
export type RecoveryClass = "residential" | "five-year";

/**
 * How a class recovers: over how many months, and by which convention the
 * first year is counted.
 *
 * - **Mid-month**: an asset placed in service in any month is treated as in
 *   service from that month's middle. January gets 11.5 months, December half
 *   of one.
 * - **Half-year**: an asset placed in service in any month is treated as in
 *   service from the middle of the year, so its month does not change its
 *   first year.
 */
export type Recovery = {
  months: number;
  convention: "mid-month" | "half-year";
};

export const RECOVERY: Readonly<Record<RecoveryClass, Recovery>> = {
  residential: { months: 330, convention: "mid-month" },
  "five-year": { months: 60, convention: "half-year" },
};

/**
 * The month an asset went into service. `assumed` is true when nobody said
 * which month and the module took July, the middle of the year, which the
 * statement says on the asset's line (#144, decision 4).
 */
export type PlacedInService = {
  year: number;
  month: number;
  assumed: boolean;
};

/** The month taken for work known only by its year. */
export const ASSUMED_MONTH = 7;

/**
 * Half-months in service by the end of `year`, counted from the start of the
 * asset's life and capped at its whole recovery period. Half-months, because
 * both conventions start an asset at a half: mid-month at the middle of a
 * month, half-year at the middle of a year, which is twelve of them.
 */
export function halfMonthsInServiceThrough(
  recovery: RecoveryClass,
  placed: Pick<PlacedInService, "year" | "month">,
  year: number,
): number {
  assertMonth(placed.month);
  if (year < placed.year) return 0;

  const { months, convention } = RECOVERY[recovery];
  const firstYear = convention === "mid-month" ? 25 - 2 * placed.month : 12;

  return Math.min(months * 2, firstYear + 24 * (year - placed.year));
}

/**
 * Half-months of `year` the asset was depreciated for: 23 for a building
 * placed in service in January, 1 for one in December, 24 for a year in the
 * middle of its life, and 0 once it is fully recovered. The statement shows
 * it, as `in service 11.5 of 12 months`.
 */
export function halfMonthsInServiceIn(
  recovery: RecoveryClass,
  placed: Pick<PlacedInService, "year" | "month">,
  year: number,
): number {
  return (
    halfMonthsInServiceThrough(recovery, placed, year) -
    halfMonthsInServiceThrough(recovery, placed, year - 1)
  );
}

/**
 * This year's depreciation of `basisCents`: what has been recovered by the
 * end of `year` less what had been by the end of the year before.
 *
 * A negative basis is a refund on work already capitalized, and recovers as
 * the mirror image of a purchase of its size.
 */
export function depreciationIn(
  basisCents: Cents,
  recovery: RecoveryClass,
  placed: Pick<PlacedInService, "year" | "month">,
  year: number,
): Cents {
  return (
    recoveredThrough(basisCents, recovery, placed, year) -
    recoveredThrough(basisCents, recovery, placed, year - 1)
  );
}

/**
 * The basis recovered by the end of `year`, rounded to the cent once. The
 * product is a `bigint`, so a large basis times 660 half-months cannot lose
 * precision on its way to the division.
 */
export function recoveredThrough(
  basisCents: Cents,
  recovery: RecoveryClass,
  placed: Pick<PlacedInService, "year" | "month">,
  year: number,
): Cents {
  assertCents(basisCents);

  const through = halfMonthsInServiceThrough(recovery, placed, year);
  const whole = RECOVERY[recovery].months * 2;

  return divideRounded(BigInt(basisCents) * BigInt(through), BigInt(whole));
}

/**
 * `n / d` to the nearest integer, halves away from zero, for a positive `d`.
 * On the magnitude, so a refund recovers the same cents a purchase does.
 */
export function divideRounded(n: bigint, d: bigint): number {
  const magnitude = n < 0n ? -n : n;
  const quotient = magnitude / d;
  const rounded = (magnitude % d) * 2n >= d ? quotient + 1n : quotient;

  return Number(n < 0n ? -rounded : rounded);
}

function assertMonth(month: number): void {
  if (!Number.isSafeInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Expected a month from 1 to 12, got ${month}.`);
  }
}

function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(
      `Expected a basis of whole cents, got ${cents}. Money is integer cents (ADR-0005).`,
    );
  }
}
