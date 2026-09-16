import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import {
  type ChartYear,
  YearBarChart,
} from "@/components/forecast/year-bar-chart";

/** One building's share of the estimate sentence, across the portfolio. */
export type EstimatedIn = { id: string; name: string; count: number };

/**
 * Ten-year capital plan (`docs/ui/screens/capex-forecast.md`): three figures,
 * the chart, and the estimate sentence.
 *
 * **The figures are not `StatTile`s.** Each is the chart beneath it summed, so
 * there is nowhere for one to link; below `sm` they stack into label-and-figure
 * rows as tiles would.
 */
export function CapitalPlanCard({
  figures,
  chart,
  estimate,
}: {
  figures: { label: string; figure: ReactNode; sub?: string }[];
  chart: {
    years: ChartYear[];
    selected: number;
    thisYear: number;
    reserveEntered: boolean;
  };
  estimate: {
    estimated: number;
    items: number;
    /** One building selected: its link. Otherwise each building's count. */
    scope: { buildingId: string } | { buildings: EstimatedIn[] };
  };
}) {
  return (
    <section
      aria-labelledby="plan-heading"
      className="flex flex-col gap-5 rounded-lg border border-border-card bg-surface-card p-5"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="plan-heading"
          className="text-md leading-tight font-semibold text-text-primary"
        >
          Ten-year capital plan
        </h2>
        <p className="text-xs leading-snug text-text-muted">
          Every tracked item, aged forward to its expected replacement year.
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3 sm:gap-4">
        {figures.map((figure) => (
          <div
            key={figure.label}
            className="flex items-center justify-between gap-4 sm:flex-col sm:items-start sm:justify-start sm:gap-2"
          >
            <dt className="flex flex-col gap-1">
              <span className="field-label">{figure.label}</span>
              {figure.sub ? (
                <span className="text-xs leading-snug text-text-muted sm:hidden">
                  {figure.sub}
                </span>
              ) : null}
            </dt>
            <dd className="flex flex-col gap-1 text-right sm:text-left">
              <span className="text-xl text-text-primary sm:text-2xl">
                {figure.figure}
              </span>
              {figure.sub ? (
                <span className="text-xs leading-snug text-text-muted max-sm:hidden">
                  {figure.sub}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>

      <YearBarChart {...chart} />

      {estimate.estimated > 0 ? <EstimateSentence {...estimate} /> : null}
    </section>
  );
}

/**
 * `{e} of {n} items have estimated install years.` (`screens/README.md`,
 * figures built on estimates) — the prompt to audit them, linked to the
 * equipment each one is in.
 */
function EstimateSentence({
  estimated,
  items,
  scope,
}: {
  estimated: number;
  items: number;
  scope: { buildingId: string } | { buildings: EstimatedIn[] };
}) {
  const lead = `${estimated} of ${items} ${items === 1 ? "item has an estimated install year" : "items have estimated install years"}`;
  const linkClass =
    "text-text-secondary underline underline-offset-4 hover:text-text-primary";

  if ("buildingId" in scope) {
    return (
      <p className="text-xs leading-snug text-text-muted">
        <Link
          href={`/buildings/${scope.buildingId}?confidence=estimated#equipment`}
          className={linkClass}
        >
          {lead}.
        </Link>
      </p>
    );
  }

  return (
    <p className="text-xs leading-snug text-text-muted">
      {lead}:{" "}
      {scope.buildings.map((building, index) => (
        <Fragment key={building.id}>
          {index > 0 ? ", " : null}
          {building.count} in{" "}
          <Link
            href={`/buildings/${building.id}?confidence=estimated#equipment`}
            className={linkClass}
          >
            {building.name}
          </Link>
        </Fragment>
      ))}
      .
    </p>
  );
}
