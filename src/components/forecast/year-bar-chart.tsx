"use client";

import { useOptimistic, useTransition } from "react";

import { useForecastParams } from "@/components/forecast/use-forecast-params";
import { cn } from "@/lib/cn";
import { type Cents, formatMoney } from "@/lib/money";

/** One bar, as the server worked it out. */
export type ChartYear = {
  year: number;
  totalCents: Cents;
  auditedCents: Cents;
  estimatedCents: Cents;
  items: number;
  estimated: number;
  /** The projected reserve goes below zero this year. */
  short: boolean;
};

/**
 * `YearBarChart` (`docs/ui/components.md` §7, `capex-forecast.md`): ten bars,
 * this year through nine years out, each the year's replacement cost.
 *
 * - **Each bar is a `<button aria-pressed>`** selecting its year into
 *   `?year=`, named in words: `2028: $47,100, 7 items, 3 estimated, reserve
 *   short`. The whole column is the button — total, bar and year — so the
 *   target is the column rather than a bar that may be two pixels tall.
 * - **Fill is binary and means something**: a year the reserve runs short
 *   takes `--meter-warn`, the selected year `--accent`, and every other
 *   `--surface-fill-strong`.
 * - **Audited cost is stacked under estimated**, and the estimated segment
 *   takes tokens §10's treatment — card fill, dashed border — so the share of
 *   a year resting on guesses shows without a second chart. A selected or
 *   short year tints the dashed segment in its own colour, or a year resting
 *   wholly on estimates could never show either.
 * - **The axis is labelled**, zero and the tallest bar in compact money, and
 *   the legend is words.
 *
 * Below `sm` the totals above the bars go — the selected year's is in the
 * heading beneath — and years read `'26`.
 */
export function YearBarChart({
  years,
  selected,
  thisYear,
  reserveEntered,
}: {
  years: ChartYear[];
  selected: number;
  thisYear: number;
  /** Until a reserve is entered no year is marked, and the legend says less. */
  reserveEntered: boolean;
}) {
  const { navigate } = useForecastParams();
  const [, startTransition] = useTransition();
  const [pressed, setPressed] = useOptimistic(selected);

  const tallest = Math.max(0, ...years.map((year) => year.totalCents));

  function choose(year: number) {
    startTransition(() => {
      setPressed(year);
      navigate((params) => {
        if (year === thisYear) params.delete("year");
        else params.set("year", String(year));
      });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {/* The axis: the tallest bar at the top, zero at the baseline. Beside
            the bars' own track, which starts under the totals' row. */}
        <div
          aria-hidden
          className="flex shrink-0 flex-col justify-between pt-0 pb-6 text-right sm:pt-5"
        >
          <span className="numeric text-2xs text-text-muted">
            {formatMoney(tallest, { form: "compact" })}
          </span>
          <span className="numeric text-2xs text-text-muted">$0</span>
        </div>

        <div
          role="group"
          aria-label="Replacement cost by year"
          className="grid flex-1 grid-cols-10 gap-1 sm:gap-2"
        >
          {years.map((year) => {
            const isSelected = year.year === pressed;
            const fill = isSelected
              ? "bg-accent"
              : year.short
                ? "bg-meter-warn"
                : "bg-surface-fill-strong";

            return (
              <button
                key={year.year}
                type="button"
                aria-pressed={isSelected}
                aria-label={label(year, reserveEntered)}
                onClick={() => choose(year.year)}
                className="group flex min-w-0 flex-col items-stretch gap-1 rounded-sm outline-offset-2"
              >
                <span
                  aria-hidden
                  className={cn(
                    "numeric hidden h-4 truncate text-center text-2xs sm:block",
                    isSelected ? "text-text-primary" : "text-text-muted",
                  )}
                >
                  {year.totalCents > 0
                    ? formatMoney(year.totalCents, { form: "compact" })
                    : null}
                </span>
                <span
                  aria-hidden
                  className="flex h-36 flex-col justify-end border-b border-border-card sm:h-40"
                >
                  {year.estimatedCents > 0 ? (
                    <span
                      className={cn(
                        "estimated-border block min-h-1 rounded-t-xs border-b-0",
                        isSelected
                          ? "bg-accent-fill [border-color:var(--color-accent)]"
                          : year.short
                            ? "bg-chart-fill-high [border-color:var(--color-meter-warn)]"
                            : "bg-surface-card",
                      )}
                      style={{ height: share(year.estimatedCents, tallest) }}
                    />
                  ) : null}
                  {year.auditedCents > 0 ? (
                    <span
                      className={cn(
                        "block min-h-0.5 transition-colors group-hover:opacity-85",
                        year.estimatedCents === 0 && "rounded-t-xs",
                        fill,
                      )}
                      style={{ height: share(year.auditedCents, tallest) }}
                    />
                  ) : null}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "numeric h-5 text-center text-2xs leading-5",
                    isSelected
                      ? "font-medium text-text-primary"
                      : "text-text-tertiary",
                  )}
                >
                  <span className="sm:hidden">
                    &rsquo;{String(year.year).slice(2)}
                  </span>
                  <span className="max-sm:hidden">{year.year}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-text-tertiary">
        {reserveEntered ? (
          <li className="flex items-center gap-2">
            <span aria-hidden className="size-3 rounded-xs bg-meter-warn" />
            Reserve runs short
          </li>
        ) : null}
        <li className="flex items-center gap-2">
          <span
            aria-hidden
            className="estimated-border size-3 rounded-xs bg-surface-card"
          />
          Estimated install year
        </li>
      </ul>
    </div>
  );
}

/** A segment's height as a share of the tallest bar's. */
function share(cents: Cents, tallest: Cents): string {
  return tallest === 0 ? "0%" : `${(cents * 100) / tallest}%`;
}

function label(year: ChartYear, reserveEntered: boolean): string {
  return [
    `${year.year}: ${formatMoney(year.totalCents)}`,
    year.items === 1 ? "1 item" : `${year.items} items`,
    year.estimated > 0 ? `${year.estimated} estimated` : null,
    reserveEntered && year.short ? "reserve short" : null,
  ]
    .filter(Boolean)
    .join(", ");
}
