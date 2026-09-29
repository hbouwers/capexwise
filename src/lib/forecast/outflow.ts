/**
 * The ten-year capital plan (`docs/ui/screens/capex-forecast.md`): every
 * active item aged forward to the years it is replaced, and what each of the
 * ten years costs, split into the cost that rests on an audited install year
 * and the cost that rests on an estimate.
 *
 * Integer cents throughout, and years rather than dates — an install year is
 * usually a guess (ADR-0005). Costs are today's replacement costs, not
 * inflated: the figure a person typed is the only one there is a source for.
 */
import { type Cents } from "@/lib/money";

import { replacementYear } from "@/lib/forecast/life";

/** This year through nine years out. */
export const FORECAST_YEARS = 10;

/**
 * A replacement cost at or above this is **Big ticket** — a forecast tag and
 * the third rule of the building flag (`docs/ui/screens/portfolio.md`). $5,000,
 * because the prototype had no consistent line and a rule cannot be tested
 * without one.
 */
export const BIG_TICKET_CENTS: Cents = 500_000;

/** A capital item, as much of it as the forecast reads. */
export type ForecastItem = {
  id: string;
  label: string;
  installYear: number;
  expectedLifeYears: number;
  replacementCostCents: Cents;
  confidence: "estimated" | "audited";
  status: "active" | "replaced" | "removed";
  /**
   * The year somebody has chosen for its next replacement (#96), or null to
   * follow the projection. A plan is a decision, where the projection is
   * arithmetic, so it wins.
   */
  plannedYear: number | null;
};

/**
 * PRD F3's sensitivity: an item's next replacement moved one, two or three
 * years, keyed by item id. Nothing here is saved (`capex-forecast.md`, What
 * if?); it is the same forecast asked again.
 */
export type Deferrals = ReadonlyMap<string, number>;

/**
 * The four derived tags, and only four: **Overdue** (its year was before this
 * one), **Due** (this year), **Big ticket** (a later year, at or above
 * `BIG_TICKET_CENTS`), and **Planned**.
 */
export type ReplacementTag = "overdue" | "due" | "big-ticket" | "planned";

/** One replacement of one item, in the year the forecast spends it. */
export type Replacement = {
  item: ForecastItem;
  /** The year it lands in the chart: never before this year. */
  year: number;
  /**
   * The year its arithmetic gives, before folding and deferral — install year
   * plus life for the first replacement, the previous one's year plus life
   * after. `year` differs from it for a past-due, a planned or a deferred
   * replacement.
   */
  naturalYear: number;
  /**
   * The year a plan chose for it (#96), on the item's next replacement only.
   * Null when it follows the projection, and on every recurrence.
   */
  plannedYear: number | null;
  /** `0` for the item's next replacement, `1` for the one after, and so on. */
  occurrence: number;
  /** Years it was moved by a deferral; `0` when it was not. */
  deferredBy: number;
  /**
   * The wider window an estimated install year puts it in, as PRD F2 asks —
   * `estimated · 2027–2030`. `null` for an audited item, for an estimated
   * one whose whole window is already past, and for a planned replacement,
   * whose year is a decision rather than a guess. The bar stays at `year`.
   */
  range: { from: number; to: number } | null;
  tag: ReplacementTag;
};

/** One bar of the chart. `auditedCents + estimatedCents` is `totalCents`. */
export type YearOutflow = {
  year: number;
  totalCents: Cents;
  auditedCents: Cents;
  estimatedCents: Cents;
  /** Sorted by cost, largest first, as the year's table is. */
  replacements: Replacement[];
};

/**
 * How far either side of its point year an estimated item may fall: a fifth of
 * its life, rounded, and at least a year. It scales with the life because the
 * seed places an unaudited item at 60% of it, so the error in that guess is a
 * share of the life rather than a fixed number of years — a smoke detector
 * guessed a year out and a roof guessed four out are the same quality of
 * guess. `life / 5` is never exactly half a year for a whole number of years,
 * so the rounding has no tie to break.
 */
export function estimateSpreadYears(expectedLifeYears: number): number {
  return Math.max(1, Math.round(expectedLifeYears / 5));
}

/**
 * The year an item's next replacement is meant for: **the plan's when there
 * is one, the projection's when not** (#96). Unfolded, so a year already gone
 * stays the year it was, for the same reason `replacementYear` keeps it.
 */
export function scheduledYear(item: ForecastItem): number {
  return item.plannedYear ?? replacementYear(item);
}

/**
 * Every replacement of every active item that lands in the ten years from
 * `thisYear`, in no particular order.
 *
 * - **A replacement already past due lands this year.** Money not yet spent
 *   can only be spent from now on, and folding it here is what makes this
 *   year's replacements the dashboard's End of life tile, as long as no plan
 *   has moved one.
 * - **An item recurs.** Once replaced it is new again and is due a life later,
 *   so a five-year smoke detector due this year is due again in five. Counting
 *   it once would understate every year after, and the reserve with them.
 *   Each recurrence is timed from the year the one before it lands, and keeps
 *   the item's confidence, since its year rests on the same install year.
 * - **A plan replaces the projection** for the next replacement (#96), and
 *   everything after it counts on from the planned year. A plan for a year
 *   already gone was not carried out, so it folds into this year like any
 *   other replacement past due.
 * - **A deferral moves the next replacement**, from the planned year when
 *   there is one, and everything after it follows.
 *
 * Replaced and removed items are not forecast: their successor is, or nothing
 * is.
 */
export function replacements(
  items: readonly ForecastItem[],
  thisYear: number,
  deferrals: Deferrals = new Map(),
): Replacement[] {
  for (const [id, years] of deferrals) {
    if (!Number.isSafeInteger(years) || years < 1 || years > 3) {
      throw new RangeError(
        `A deferral is one, two or three years, got ${years} for ${id}.`,
      );
    }
  }

  const lastYear = thisYear + FORECAST_YEARS - 1;
  const found: Replacement[] = [];

  for (const item of items) {
    if (item.status !== "active") continue;

    const life = item.expectedLifeYears;
    if (!Number.isSafeInteger(life) || life <= 0) {
      throw new RangeError(
        `Expected a life of whole years above zero, got ${life} for ${item.id}.`,
      );
    }

    const deferredBy = deferrals.get(item.id) ?? 0;
    let naturalYear = replacementYear(item);
    let year = Math.max(thisYear, item.plannedYear ?? naturalYear) + deferredBy;

    for (let occurrence = 0; year <= lastYear; occurrence++) {
      const planned = occurrence === 0 ? item.plannedYear : null;

      found.push({
        item,
        year,
        naturalYear,
        plannedYear: planned,
        occurrence,
        deferredBy: occurrence === 0 ? deferredBy : 0,
        range:
          planned === null
            ? estimateRange(
                item,
                naturalYear,
                occurrence === 0 ? deferredBy : 0,
                thisYear,
              )
            : null,
        // Overdue is measured from the year it was meant for: the plan's,
        // when there is one.
        tag: tagFor(item, year, planned ?? naturalYear, thisYear),
      });

      naturalYear = year + life;
      year = naturalYear;
    }
  }

  return found;
}

/**
 * The window around the natural year, folded the way the year itself is — no
 * end before this year — and then moved by any deferral. An item so far past
 * due that the whole window is behind us is due now whichever end is true, so
 * it has no range.
 */
function estimateRange(
  item: ForecastItem,
  naturalYear: number,
  deferredBy: number,
  thisYear: number,
): Replacement["range"] {
  if (item.confidence === "audited") return null;

  const spread = estimateSpreadYears(item.expectedLifeYears);
  const from = Math.max(thisYear, naturalYear - spread) + deferredBy;
  const to = Math.max(thisYear, naturalYear + spread) + deferredBy;

  return from === to ? null : { from, to };
}

function tagFor(
  item: ForecastItem,
  year: number,
  meantFor: number,
  thisYear: number,
): ReplacementTag {
  if (year === thisYear) return meantFor < thisYear ? "overdue" : "due";
  if (item.replacementCostCents >= BIG_TICKET_CENTS) return "big-ticket";
  return "planned";
}

/**
 * The ten bars, this year first, each with its replacements. A year with
 * nothing due is still a bar, at zero, because the chart draws ten.
 */
export function outflowByYear(
  found: readonly Replacement[],
  thisYear: number,
): YearOutflow[] {
  const years: YearOutflow[] = Array.from(
    { length: FORECAST_YEARS },
    (_, index) => ({
      year: thisYear + index,
      totalCents: 0,
      auditedCents: 0,
      estimatedCents: 0,
      replacements: [],
    }),
  );

  for (const replacement of found) {
    const bar = years[replacement.year - thisYear];
    if (!bar) {
      throw new RangeError(
        `A replacement in ${replacement.year} is outside the ten years from ${thisYear}.`,
      );
    }

    const cost = replacement.item.replacementCostCents;
    assertCents(cost, replacement.item.id);

    bar.totalCents += cost;
    if (replacement.item.confidence === "audited") bar.auditedCents += cost;
    else bar.estimatedCents += cost;
    bar.replacements.push(replacement);
  }

  for (const bar of years) bar.replacements.sort(byCostDescending);

  return years;
}

/**
 * Largest first. Equal costs fall back to the label and then the id, so the
 * table and the low-point sentence name the same two items on every render.
 */
function byCostDescending(a: Replacement, b: Replacement): number {
  return (
    b.item.replacementCostCents - a.item.replacementCostCents ||
    compare(a.item.label, b.item.label) ||
    compare(a.item.id, b.item.id)
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function assertCents(cents: number, id: string): void {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError(
      `Expected a replacement cost of whole, non-negative cents, got ${cents} for ${id}.`,
    );
  }
}

/** The 10-year total: everything due this year through nine years out. */
export function tenYearTotalCents(years: readonly YearOutflow[]): Cents {
  return years.reduce((sum, bar) => sum + bar.totalCents, 0);
}

/**
 * **Level funding**: the ten years' replacements over 120 months — the
 * building page's `Ten-year need / mo`, and the forecast's second figure
 * before a reserve is entered. Rounded **up** to the cent, so saving this much
 * a month never leaves the total a few cents short.
 */
export function levelFundingPerMonthCents(
  years: readonly YearOutflow[],
): Cents {
  return ceilDivide(tenYearTotalCents(years), FORECAST_YEARS * 12);
}

/**
 * `⌈n / d⌉` for a non-negative `n` and a positive `d`, on the remainder so the
 * quotient never passes through a fraction.
 */
export function ceilDivide(n: number, d: number): number {
  const remainder = n % d;
  const floor = (n - remainder) / d;

  return remainder === 0 ? floor : floor + 1;
}
