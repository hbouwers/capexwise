import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BuildingSelect } from "@/components/forecast/building-select";
import {
  CapitalPlanCard,
  type EstimatedIn,
} from "@/components/forecast/capital-plan-card";
import { ReserveCard } from "@/components/forecast/reserve-card";
import { type ItemPlace, YearTable } from "@/components/forecast/year-table";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { todayIn } from "@/lib/dates";
import { replacementYear } from "@/lib/forecast/life";
import {
  forecastHref,
  forecastToday,
  parseDeferrals,
  parseForecastYear,
} from "@/lib/forecast/params";
import { forecast } from "@/lib/forecast/plan";
import { getForecastInputs } from "@/server/queries/forecast";

/**
 * The CapEx forecast (`docs/ui/screens/capex-forecast.md`), PRD F3: every
 * tracked item aged forward ten years, against the reserve that has to pay for
 * it — across the portfolio, or one building in `?building=`.
 *
 * **Every figure is `forecast()` from `src/lib/forecast/`**, called once, so
 * the chart, the three figures, the year's table and the reserve cannot
 * disagree. A `What if?` deferral in `?defer=` is the same call with the item
 * moved; nothing is saved.
 */
export const metadata: Metadata = { title: "CapEx forecast — CapExWise" };

const TITLE = "CapEx forecast";
const SUBTITLE = "Ten-year capital plan, aged from equipment records";

export default async function ForecastPage({
  searchParams,
}: PageProps<"/forecast">) {
  const query = await searchParams;
  const inputs = await getForecastInputs();

  const building =
    inputs.buildings.find((candidate) => candidate.id === query.building) ??
    null;
  const items = building
    ? inputs.items.filter((item) => item.buildingId === building.id)
    : inputs.items;

  // Today where the building is; across the portfolio, the latest of them.
  const today = building
    ? todayIn(building.timezone)
    : forecastToday(inputs.buildings.map((candidate) => candidate.timezone));

  const { deferrals, dropped } = parseDeferrals(
    query.defer,
    new Set(items.map((item) => item.id)),
  );

  const select =
    inputs.buildings.length > 0 ? (
      <BuildingSelect
        buildings={inputs.buildings.map(({ id, name }) => ({ id, name }))}
        selected={building?.id ?? null}
      />
    ) : null;

  if (items.length === 0) {
    return (
      <>
        <PageHeader title={TITLE} subtitle={SUBTITLE} actions={select} />
        <PageBody>
          <EmptyState
            title="Nothing to forecast yet"
            body="The forecast is built from equipment. Add it to a building and each replacement lands here."
            action={
              <Button asChild>
                <Link href={building ? `/buildings/${building.id}` : "/"}>
                  {building ? `Go to ${building.name}` : "Go to your buildings"}
                </Link>
              </Button>
            }
          />
        </PageBody>
      </>
    );
  }

  // The reserve is the org's: with a building selected there is no share of it
  // to project, and no year to mark short.
  const reserve = building ? null : inputs.reserve;
  const result = forecast({
    items,
    today,
    reserve: reserve && {
      balanceCents: reserve.balanceCents,
      monthlyContributionCents: reserve.monthlyContributionCents,
    },
    deferrals,
  });
  const year = parseForecastYear(query.year, result.thisYear);

  // A deferral that changes nothing is taken out of the URL, silently.
  if (dropped) {
    redirect(
      forecastHref({
        building: building?.id,
        year,
        thisYear: result.thisYear,
        deferrals,
      }),
    );
  }

  const buildingsById = new Map(
    inputs.buildings.map((candidate) => [candidate.id, candidate]),
  );
  const places = new Map<string, ItemPlace>();
  // `Roof, Sumner St` for the deferral bar; `Roof at Sumner St` in a sentence.
  const names = new Map<string, string>();
  const namesAt = new Map<string, string>();
  for (const item of items) {
    const owner = buildingsById.get(item.buildingId);
    if (!owner) continue;

    places.set(item.id, {
      buildingId: owner.id,
      buildingName: owner.name,
      scope: owner.unitCount > 1 ? (item.unitLabel ?? "Shared") : null,
    });
    names.set(item.id, `${item.label}, ${owner.name}`);
    namesAt.set(item.id, `${item.label} at ${owner.name}`);
  }

  const short = new Set(result.reserve?.projection.shortYears ?? []);
  const selectedBar =
    result.years.find((bar) => bar.year === year) ?? result.years[0]!;

  const estimated = items.filter((item) => item.confidence === "estimated");
  const estimatedIn: EstimatedIn[] = inputs.buildings
    .map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      count: estimated.filter((item) => item.buildingId === candidate.id)
        .length,
    }))
    .filter((entry) => entry.count > 0);

  const figures = [
    { label: "10-year total", figure: <Money cents={result.totalCents} /> },
    result.reserve
      ? {
          label: "Reserve needed / mo",
          figure: <Money cents={result.reserve.neededPerMonthCents} />,
          sub: "to stay above zero for ten years",
        }
      : {
          label: "Reserve needed / mo",
          figure: <Money cents={result.levelFundingPerMonthCents} />,
          sub: "to fund the next ten years evenly",
        },
    ...(reserve
      ? [
          {
            label: "Contributing / mo",
            figure: <Money cents={reserve.monthlyContributionCents} />,
          },
        ]
      : []),
  ];

  // `Roof, Sumner St → 2030`: where the deferral put its next replacement,
  // which may be past the ten years the chart draws.
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const deferred = [...deferrals].map(([id, years]) => {
    const item = itemsById.get(id)!;
    const moved = Math.max(result.thisYear, replacementYear(item)) + years;
    return `${names.get(id)} → ${moved}`;
  });

  const lowYear = result.reserve
    ? result.years.find(
        (bar) => bar.year === result.reserve!.projection.lowest.year,
      )
    : undefined;

  return (
    <>
      <PageHeader title={TITLE} subtitle={SUBTITLE} actions={select} />
      <PageBody>
        <div className="flex flex-col gap-5">
          {deferred.length > 0 ? (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-accent-border bg-accent-fill px-4 py-2.5"
            >
              <p className="text-sm leading-snug text-text-primary">
                Showing{" "}
                {deferred.length === 1
                  ? "1 change"
                  : `${deferred.length} changes`}
                : {deferred.join("; ")}
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={forecastHref({
                    building: building?.id,
                    year,
                    thisYear: result.thisYear,
                  })}
                  scroll={false}
                >
                  Clear
                </Link>
              </Button>
            </div>
          ) : null}

          <CapitalPlanCard
            figures={figures}
            chart={{
              years: result.years.map((bar) => ({
                year: bar.year,
                totalCents: bar.totalCents,
                auditedCents: bar.auditedCents,
                estimatedCents: bar.estimatedCents,
                items: bar.replacements.length,
                estimated: bar.replacements.filter(
                  (replacement) => replacement.item.confidence === "estimated",
                ).length,
                short: short.has(bar.year),
              })),
              selected: year,
              thisYear: result.thisYear,
              reserveEntered: result.reserve !== null,
            }}
            estimate={{
              estimated: estimated.length,
              items: items.length,
              scope: building
                ? { buildingId: building.id }
                : { buildings: estimatedIn },
            }}
          />

          <div className="grid-two-column items-start">
            <YearTable
              bar={selectedBar}
              places={places}
              deferrals={[...deferrals]}
            />
            <ReserveCard
              today={today}
              state={
                building
                  ? { kind: "building" }
                  : reserve && result.reserve && lowYear
                    ? {
                        kind: "projected",
                        reserve,
                        projection: result.reserve.projection,
                        lowYear,
                        names: namesAt,
                      }
                    : { kind: "none" }
              }
            />
          </div>
        </div>
      </PageBody>
    </>
  );
}
