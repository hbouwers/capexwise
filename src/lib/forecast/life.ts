/**
 * Where an item is in its life, as the building's equipment table shows it
 * (`docs/ui/screens/building-detail.md`, Equipment & capital items): its age,
 * the year it is due to be replaced, and the status those put it in. The
 * forecast (#111) and the portfolio's flag build on these, so the table and
 * the chart can never disagree about when a furnace is due.
 *
 * Years, not dates. An install year is usually a guess (ADR-0005), and
 * nothing here pretends to know the month.
 */

/** The fields of a capital item these rules read. */
export type AgedItem = { installYear: number; expectedLifeYears: number };

/**
 * `components.md` §6's four states, at 60, 85 and 100% of the expected life:
 * under 60% healthy, from 60% watch, from 85% due soon, and from 100% past
 * life.
 */
export type LifeStatus = "healthy" | "watch" | "due-soon" | "past-life";

/**
 * **The year it is due, as stored arithmetic: install year plus life.** A
 * past-due item keeps its real year — a 2019 here reads as seven years late,
 * which is information. Folding it into this year is the forecast chart's
 * business, since money not yet spent can only be spent from now on
 * (`capex-forecast.md`).
 */
export function replacementYear(item: AgedItem): number {
  return item.installYear + item.expectedLifeYears;
}

/**
 * Whole years in service this year: `this year − install year`, and never
 * below zero. An install year after this one is a typo or a plan, and an
 * item that has not been installed has not aged.
 */
export function ageInYears(item: AgedItem, thisYear: number): number {
  return Math.max(0, thisYear - item.installYear);
}

/**
 * Compared in whole numbers — `age × 100` against `life × 85` — rather than as
 * a fraction, so an item at exactly 85% is due soon on every runtime and not
 * only on the ones whose floating point rounds up.
 *
 * **Past life starts in the replacement year itself**, at 100%: a furnace due
 * this year is past life this year, which is the year the forecast tags it
 * `Due`.
 */
export function lifeStatus(item: AgedItem, thisYear: number): LifeStatus {
  const used = ageInYears(item, thisYear) * 100;
  const life = item.expectedLifeYears;

  if (used >= life * 100) return "past-life";
  if (used >= life * 85) return "due-soon";
  if (used >= life * 60) return "watch";
  return "healthy";
}

/**
 * How much of its life it has used, as a whole percentage capped at 100 — the
 * length of `LifeBar`. Capped because a bar cannot be longer than its track,
 * and the text beside it (`41 / 15 yr`) says how far past it is.
 */
export function lifeUsedPercent(item: AgedItem, thisYear: number): number {
  return Math.min(
    100,
    Math.round((ageInYears(item, thisYear) * 100) / item.expectedLifeYears),
  );
}
