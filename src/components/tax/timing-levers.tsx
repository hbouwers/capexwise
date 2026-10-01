import { DeltaValue } from "@/components/money";
import { StatementLine } from "@/components/tax/statement-line";
import { formatDate } from "@/lib/dates";
import { type Cents, formatMoney } from "@/lib/money";
import type { TimingLever } from "@/lib/tax/estimate";
import { underDeMinimis } from "@/lib/tax/statement";

/**
 * Timing levers (`docs/ui/screens/tax-planner.md`): each classified plan that
 * could move across the turn of the year, the move, and what it does to this
 * year — biggest saving first, as `estimate()` orders them. Each opens its
 * arithmetic like a statement line.
 *
 * An undecided plan has no lever: it counts for nothing either way. Nothing
 * here moves a plan; the levers say what a move would do.
 */
export function TimingLevers({
  year,
  levers,
  taxableCents,
  deMinimisFor,
  buildingNames,
}: {
  year: number;
  levers: TimingLever[];
  /** This year's taxable rental income, as the statement has it. */
  taxableCents: Cents;
  /** Each year's threshold, so a move can say whether it is deducted. */
  deMinimisFor: (year: number) => Cents | null;
  /** Set across the portfolio, so a lever names its building. */
  buildingNames: ReadonlyMap<string, string> | null;
}) {
  return (
    <section
      aria-labelledby="levers-heading"
      className="flex flex-col gap-2 rounded-lg border border-border-card bg-surface-card p-5"
    >
      <h2
        id="levers-heading"
        className="text-md leading-tight font-semibold text-text-primary"
      >
        Timing levers
      </h2>
      {levers.length === 0 ? (
        <p className="text-sm leading-normal text-text-tertiary">
          No classified plan this year or next would change {year} by moving.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-divider">
          {levers.map((lever) => {
            const { plan } = lever;
            const to = monthYear(lever.to.year, lever.to.month);
            const where = buildingNames?.get(plan.buildingId);
            const effect =
              lever.liabilityEffectCents ?? lever.taxableEffectCents;

            return (
              <li key={plan.id}>
                <StatementLine
                  label={
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium text-text-primary">
                        Move {plan.label}
                        {where ? ` at ${where}` : ""} into {to}
                      </span>
                      <span className="text-xs leading-snug text-text-tertiary">
                        {mechanism(lever, deMinimisFor)}
                      </span>
                    </span>
                  }
                  value={
                    <span className="flex flex-col items-end gap-0.5">
                      <DeltaValue cents={effect} />
                      <span className="text-2xs text-text-muted">
                        {lever.liabilityEffectCents === null
                          ? `taxable income ${year}`
                          : `in ${year}`}
                      </span>
                    </span>
                  }
                >
                  <dl className="flex flex-col gap-1.5 py-1">
                    <div className="flex justify-between gap-4">
                      <dt>Planned for</dt>
                      <dd>
                        {monthYear(lever.from.year, lever.from.month)}
                        {lever.from.assumed ? " (month assumed)" : ""}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt>Taxable rental income {year}</dt>
                      <dd>
                        {formatMoney(taxableCents)} →{" "}
                        {formatMoney(taxableCents + lever.taxableEffectCents)}
                      </dd>
                    </div>
                  </dl>
                </StatementLine>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * `$18,500 capitalized · depreciation starts a year earlier`, or a repair's
 * deduction moving with it.
 */
function mechanism(
  lever: TimingLever,
  deMinimisFor: (year: number) => Cents | null,
): string {
  const { plan, from, to } = lever;
  const cost = formatMoney(plan.costCents);
  const deducted =
    plan.classification === "repair" ||
    underDeMinimis(plan.costCents, deMinimisFor(to.year));

  if (deducted) {
    return `${cost} deducted in ${to.year} instead of ${from.year}`;
  }
  return `${cost} capitalized · depreciation starts a year ${to.year < from.year ? "earlier" : "later"}`;
}

/** `Dec 2026`. */
function monthYear(year: number, month: number): string {
  return formatDate(`${year}-${String(month).padStart(2, "0")}-01`, "month");
}
