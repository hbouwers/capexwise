import { DeltaValue, Money } from "@/components/money";
import { Numeric } from "@/components/numeric";
import { RateForm } from "@/components/tax/rate-form";
import type { Cents } from "@/lib/money";
import type { Liability } from "@/lib/tax/estimate";
import { formatRate } from "@/lib/tax/rate-form";

/**
 * Estimated liability (`docs/ui/screens/tax-planner.md`): the rail's first
 * card, the one `--text-3xl` figure in the product, and the arithmetic beneath
 * it in words, with the rate it multiplies by as a field on the card.
 *
 * **No rate, no figure.** Until one is entered the card asks for it in the
 * figure's place (#144, decision 2). **A loss is a liability of zero**, and
 * the card says the year is a loss rather than showing a saving.
 */
export function LiabilityCard({
  year,
  liability,
  rateBps,
  newBasisCents,
}: {
  year: number;
  liability: Liability | null;
  rateBps: number | null;
  newBasisCents: Cents;
}) {
  return (
    <section
      aria-labelledby="liability-heading"
      className="flex flex-col gap-4 rounded-lg border border-border-card bg-surface-card p-5"
    >
      <div className="flex flex-col gap-2">
        <h2 id="liability-heading" className="field-label">
          Estimated {year} liability
        </h2>
        {liability ? (
          <>
            <Money
              cents={liability.liabilityCents}
              className="text-3xl text-text-primary"
            />
            <p className="text-xs leading-snug text-text-tertiary">
              {liability.loss
                ? `Taxable rental income is a loss this year, so the estimate is zero. Whether a loss comes off other income depends on rules this estimate does not cover.`
                : `Taxable rental income × ${formatRate(liability.rateBps)} blended rate`}
            </p>
          </>
        ) : (
          <p className="text-sm leading-normal text-text-secondary">
            Enter your blended rate to estimate the liability. There is no
            default: the figure is only as good as the rate behind it.
          </p>
        )}
      </div>

      <RateForm rateBps={rateBps} year={year} />

      <dl className="flex flex-col gap-3 border-t border-border-divider pt-4 text-sm">
        {liability ? (
          <>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-text-secondary">
                Against doing nothing
                <span className="block text-2xs text-text-muted">
                  every plan this year left undecided
                </span>
              </dt>
              <dd>
                <DeltaValue
                  cents={liability.againstDoingNothingCents}
                  className="text-text-primary"
                />
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-text-secondary">Effective rate on rents</dt>
              <dd>
                {liability.effectiveRateBps === null ? (
                  <span className="text-text-muted">No rent</span>
                ) : (
                  <Numeric className="text-text-primary">
                    {formatRate(liability.effectiveRateBps)}
                  </Numeric>
                )}
              </dd>
            </div>
          </>
        ) : null}
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-text-secondary">
            New basis added
            <span className="block text-2xs text-text-muted">
              improvements capitalized this year
            </span>
          </dt>
          <dd>
            <Money cents={newBasisCents} className="text-text-primary" />
          </dd>
        </div>
      </dl>
    </section>
  );
}
