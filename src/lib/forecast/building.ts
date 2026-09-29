/**
 * The summaries a building's card and page carry about its equipment
 * (`docs/ui/screens/portfolio.md`, Your buildings): the flag, systems life
 * used, and CapEx through next year — and the portfolio's End of life tile.
 * Built on the same age and replacement year as the equipment table and the
 * forecast, so the card cannot say `Healthy` over a table with a row past
 * life.
 */
import { ageInYears, lifeStatus } from "@/lib/forecast/life";
import {
  BIG_TICKET_CENTS,
  type ForecastItem,
  replacements,
  scheduledYear,
} from "@/lib/forecast/outflow";

export type BuildingFlag =
  | { kind: "past-life"; count: number }
  | { kind: "due-soon"; count: number }
  | { kind: "big-ticket"; item: ForecastItem; year: number }
  | { kind: "healthy" };

/**
 * First match wins:
 *
 * 1. Any active item past life → `{n} past life`.
 * 2. Any at 85% of its life or more → `{n} due soon`.
 * 3. A big-ticket replacement in the next three years → `{item} {year}`: the
 *    earliest, and the costliest of that year.
 * 4. Otherwise `Healthy`.
 *
 * "The next three years" are the three after this one. An item due this year
 * or earlier is past life, which the first rule has already said.
 *
 * **The first two rules read the item's age and ignore a plan** (#96). A
 * furnace planned for 2029 is still past life today, and a plan to live with
 * that does not make it healthy. The third reads the forecast, so it takes
 * the planned year, as the chart does.
 */
export function buildingFlag(
  items: readonly ForecastItem[],
  thisYear: number,
): BuildingFlag {
  const active = items.filter((item) => item.status === "active");
  const statuses = active.map((item) => lifeStatus(item, thisYear));

  const pastLife = statuses.filter((s) => s === "past-life").length;
  if (pastLife > 0) return { kind: "past-life", count: pastLife };

  const dueSoon = statuses.filter((s) => s === "due-soon").length;
  if (dueSoon > 0) return { kind: "due-soon", count: dueSoon };

  const bigTicket = replacements(active, thisYear)
    .filter(
      (r) =>
        r.occurrence === 0 &&
        r.year <= thisYear + 3 &&
        r.item.replacementCostCents >= BIG_TICKET_CENTS,
    )
    .sort(
      (a, b) =>
        a.year - b.year ||
        b.item.replacementCostCents - a.item.replacementCostCents ||
        compare(a.item.label, b.item.label) ||
        compare(a.item.id, b.item.id),
    )[0];
  if (bigTicket) {
    return { kind: "big-ticket", item: bigTicket.item, year: bigTicket.year };
  }

  return { kind: "healthy" };
}

/**
 * **Systems life used**, a whole percentage: the replacement-cost-weighted
 * mean of each active item's age over its life, each capped at 100%. Weighted,
 * because a roof at 90% matters more than a microwave at 90%; capped, because
 * one item forty years past life should not read as a building at 300%.
 *
 * Exact until the one rounding at the end, half up: the sum is a fraction with
 * every life in its denominator, kept in `bigint`. When every item costs
 * nothing there is no weight to take, and each counts the same.
 *
 * `null` when there is no active item, which the card renders as
 * `No equipment yet` rather than a building at 0%.
 */
export function systemsLifeUsedPercent(
  items: readonly ForecastItem[],
  thisYear: number,
): number | null {
  const active = items.filter((item) => item.status === "active");
  if (active.length === 0) return null;

  const weighted = active.some((item) => item.replacementCostCents > 0);

  // numerator / denominator is Σ weight × used ÷ life, and total is Σ weight.
  let numerator = 0n;
  let denominator = 1n;
  let total = 0n;

  for (const item of active) {
    const weight = weighted ? BigInt(item.replacementCostCents) : 1n;
    const life = BigInt(item.expectedLifeYears);
    const used = BigInt(
      Math.min(ageInYears(item, thisYear), item.expectedLifeYears),
    );

    numerator = numerator * life + weight * used * denominator;
    denominator *= life;
    total += weight;
  }

  // round(100 × numerator ÷ (denominator × total)), half up.
  const scale = denominator * total;
  return Number((200n * numerator + scale) / (2n * scale));
}

/**
 * **CapEx through {next year}**: the replacement cost of active items whose
 * next replacement is meant for next year or earlier — past-due ones
 * included, and not their recurrences, which the ten-year figures count.
 * "Meant for" is the planned year when there is one (#96), so this tile and
 * the forecast's bars move together when a plan moves a roof. A replacement year
 * is a year, so "the next twelve months" is not a set the data can name; the
 * label states the boundary this sum uses (`portfolio.md`). The building
 * page's tile and the portfolio's card are both this.
 */
export function capexThroughNextYear(
  items: readonly ForecastItem[],
  thisYear: number,
): { cents: number; items: number; pastLife: number } {
  const due = items.filter(
    (item) => item.status === "active" && scheduledYear(item) <= thisYear + 1,
  );

  return {
    cents: due.reduce((sum, item) => sum + item.replacementCostCents, 0),
    items: due.length,
    pastLife: due.filter((item) => lifeStatus(item, thisYear) === "past-life")
      .length,
  };
}

/**
 * The End of life tile: active items at or past their expected life, split by
 * whether the install year behind each is audited or estimated — PRD F0's
 * "flagged as estimates rather than mixed in silently". The same set as the
 * forecast's bar for this year, which folds every past-due replacement into
 * it; the tile links there.
 */
export function endOfLife(
  items: readonly ForecastItem[],
  thisYear: number,
): { audited: number; estimated: number } {
  const past = items.filter(
    (item) =>
      item.status === "active" && lifeStatus(item, thisYear) === "past-life",
  );
  const audited = past.filter((item) => item.confidence === "audited").length;

  return { audited, estimated: past.length - audited };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
