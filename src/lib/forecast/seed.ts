/**
 * The install year an item of unknown age starts from
 * (`docs/ui/screens/modal-add-equipment.md`, the seed). Every item the
 * checklist adds arrives with one, marked `estimated`, until somebody reads
 * the label.
 *
 * Forecast logic rather than a form default: the year chosen here decides
 * when the forecast first spends money on the item, so it is tested with the
 * forecast's rules. Framework-free, like the rest of `src/lib/`.
 */

/**
 * `max(build year, this year − round(0.6 × life))`, or the second term alone
 * when the build year is not known.
 *
 * - **60% of the way through its life**, because an item nobody has aged is
 *   more likely mid-life than new or failing, and it gives a new building's
 *   forecast a spread of years rather than everything due at once.
 * - **Never before the building**, because the build year is the one hard
 *   fact there is. The prototype's floor of 1990 had no reason behind it.
 * - **Never after this year.** A build year still to come — a building under
 *   construction — would otherwise seed an install that has not happened, and
 *   an estimate of the past cannot be in the future.
 *
 * The rounding is on `3 × life / 5`, which is never exactly half a year for a
 * whole number of years, so there is no tie for `Math.round` to break.
 */
export function seedInstallYear(
  lifeYears: number,
  buildYear: number | null,
  thisYear: number,
): number {
  if (!Number.isSafeInteger(lifeYears) || lifeYears <= 0) {
    throw new RangeError(
      `Expected a life of whole years above zero, got ${lifeYears}.`,
    );
  }

  const midLife = thisYear - Math.round((lifeYears * 3) / 5);

  if (buildYear === null) return midLife;

  return Math.min(thisYear, Math.max(buildYear, midLife));
}
