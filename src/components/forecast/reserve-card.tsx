import { UpdateReserve } from "@/components/forecast/update-reserve";
import { DateValue } from "@/components/date-value";
import { EmptyState } from "@/components/empty-state";
import { DeltaValue, Money } from "@/components/money";
import { cn } from "@/lib/cn";
import type { CalendarDate } from "@/lib/dates";
import type { YearOutflow } from "@/lib/forecast/outflow";
import type { ReserveProjection } from "@/lib/forecast/reserve";
import type { StoredReserve } from "@/server/queries/forecast";

/**
 * Reserve projection (`docs/ui/screens/capex-forecast.md`): the org's reserve
 * projected to its lowest point in the ten years, in four lines that add up —
 * balance, plus contributions to that year, less replacements through it — and
 * the sentence naming what makes it the low point.
 *
 * **The reserve is the org's, not a building's** (#92), so with a building
 * selected the card says so rather than inventing a share.
 */
export function ReserveCard({
  state,
  today,
}: {
  state:
    | { kind: "building" }
    | { kind: "none" }
    | {
        kind: "projected";
        reserve: StoredReserve;
        projection: ReserveProjection;
        lowYear: YearOutflow;
        /** `Roof at Sumner St`, by item id. */
        names: ReadonlyMap<string, string>;
      };
  today: CalendarDate;
}) {
  if (state.kind === "none") {
    return (
      <EmptyState
        title="Add your reserve"
        body="Enter what you have set aside and what you add each month, and this shows the years it runs short."
        action={
          <UpdateReserve current={null} today={today} variant="default" />
        }
      />
    );
  }

  return (
    <section
      aria-labelledby="reserve-heading"
      className="flex flex-col gap-4 rounded-lg border border-border-card bg-surface-card p-5"
    >
      <h2
        id="reserve-heading"
        className="text-md leading-tight font-semibold text-text-primary"
      >
        Reserve projection
      </h2>

      {state.kind === "building" ? (
        <p className="text-sm leading-normal text-text-tertiary">
          The reserve is held across the portfolio. Choose All buildings to see
          its projection.
        </p>
      ) : (
        <Projected {...state} today={today} />
      )}
    </section>
  );
}

function Projected({
  reserve,
  projection,
  lowYear,
  names,
  today,
}: {
  reserve: StoredReserve;
  projection: ReserveProjection;
  lowYear: YearOutflow;
  names: ReadonlyMap<string, string>;
  today: CalendarDate;
}) {
  const low = projection.lowest;

  return (
    <>
      <dl className="flex flex-col gap-3 text-sm">
        <div className="flex items-start justify-between gap-4">
          <dt className="text-text-secondary">
            Balance
            <span className="block text-2xs text-text-muted">
              as of <DateValue date={reserve.asOf} />
            </span>
          </dt>
          <dd>
            <Money
              cents={projection.balanceCents}
              className="text-text-primary"
            />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-text-secondary">Contributions to {low.year}</dt>
          <dd>
            <DeltaValue
              cents={low.contributionsCents}
              className="text-text-primary"
            />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-text-secondary">
            Replacements through {low.year}
          </dt>
          <dd>
            <DeltaValue
              cents={-low.replacementsCents}
              className="text-text-primary"
            />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 border-t border-border-divider pt-3">
          <dt className="font-medium text-text-primary">
            Lowest point, {low.year}
          </dt>
          <dd>
            <DeltaValue
              cents={low.balanceCents}
              className={cn(
                "font-medium",
                low.balanceCents < 0
                  ? "text-status-danger"
                  : "text-text-primary",
              )}
            />
          </dd>
        </div>
      </dl>

      <p className="text-xs leading-snug text-text-tertiary">
        {lowPointSentence(lowYear, names)}
      </p>

      <div>
        <UpdateReserve current={reserve} today={today} />
      </div>
    </>
  );
}

/**
 * `2028 is the low point: Roof at Sumner St and Furnace at Rowan Court land
 * that year.` — its two largest items, by name. Labels are the person's own,
 * so they are not lowercased into the spec's `the Sumner roof`: an `AC
 * condenser` would not survive it. The prototype went on to
 * advise pulling one forward, which is F8's to do with its inputs shown.
 *
 * A low point with nothing landing in it can only be this year: a later year
 * with nothing due is never lower than the one before it, and a tie goes to
 * the earlier year.
 */
function lowPointSentence(
  bar: YearOutflow,
  names: ReadonlyMap<string, string>,
): string {
  const largest = bar.replacements
    .slice(0, 2)
    .map(
      (replacement) => names.get(replacement.item.id) ?? replacement.item.label,
    );

  if (largest.length === 0) {
    return `${bar.year} is the low point: nothing is due, and no later year takes the balance below it.`;
  }

  const more = bar.replacements.length - largest.length;
  const listed =
    largest.length === 1 ? largest[0] : `${largest[0]} and ${largest[1]}`;

  return more > 0
    ? `${bar.year} is the low point: ${listed} land that year, with ${more === 1 ? "1 more item" : `${more} more items`}.`
    : `${bar.year} is the low point: ${listed} ${largest.length === 1 ? "lands" : "land"} that year.`;
}
