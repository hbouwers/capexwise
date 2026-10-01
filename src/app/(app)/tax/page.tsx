import type { Metadata } from "next";
import Link from "next/link";

import { BuildingSelect } from "@/components/building-select";
import { EmptyState } from "@/components/empty-state";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { DecisionRow } from "@/components/tax/decision-row";
import { IncomeStatement } from "@/components/tax/income-statement";
import { LiabilityCard } from "@/components/tax/liability-card";
import { TaxDisclaimer } from "@/components/tax/tax-disclaimer";
import { TimingLevers } from "@/components/tax/timing-levers";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { estimate } from "@/lib/tax/estimate";
import { deMinimisFor } from "@/lib/tax/statement";
import { getTaxInputs } from "@/server/queries/tax";

/**
 * The tax planner (`docs/ui/screens/tax-planner.md`), PRD F4: an estimated
 * Schedule E for the year, across the portfolio or for one building in
 * `?building=`, and what the repair-or-improvement calls and their timing
 * change.
 *
 * **Every figure is `estimate()` from `src/lib/tax/`**, called once, so the
 * statement, the liability, each decision's effect and the levers cannot
 * disagree. A changed call or rate is saved on the server and the page
 * re-renders; nothing is worked out in the browser.
 *
 * **The disclaimer is first, always.** It renders before the empty state, and
 * in the loading state, so no figure on this page is ever on screen without it.
 *
 * The year is this one alone until #44 freezes filed years, so there is no
 * year `Select` yet: a list of one is not a choice.
 */
export const metadata: Metadata = { title: "Tax planner — CapExWise" };

export default async function TaxPage({ searchParams }: PageProps<"/tax">) {
  const query = await searchParams;
  const inputs = await getTaxInputs();
  const { year } = inputs;

  const building =
    inputs.buildings.find((candidate) => candidate.id === query.building) ??
    null;
  const mine = <T extends { buildingId: string }>(rows: T[]) =>
    building ? rows.filter((row) => row.buildingId === building.id) : rows;

  const buildings = building ? [building] : inputs.buildings;
  const plans = mine(inputs.plans);
  const result = estimate({
    year,
    buildings,
    expenses: mine(inputs.expenses),
    items: mine(inputs.items),
    plans,
    deMinimis: inputs.deMinimis,
    rateBps: inputs.rateBps,
  });
  const s = result.statement;

  const select =
    inputs.buildings.length > 0 ? (
      <BuildingSelect
        buildings={inputs.buildings.map(({ id, name }) => ({ id, name }))}
        selected={building?.id ?? null}
      />
    ) : null;
  const header = (
    <PageHeader
      title="Tax planner"
      subtitle={`${year} estimate · Schedule E`}
      actions={select}
    />
  );

  const recordedThisYear = mine(inputs.expenses).some((expense) =>
    expense.occurredOn.startsWith(`${year}-`),
  );
  const plannedThisYear = result.decisions.length > 0;
  if (s.grossRent.totalCents === 0 && !recordedThisYear && !plannedThisYear) {
    return (
      <>
        {header}
        <PageBody>
          <div className="flex flex-col gap-5">
            <TaxDisclaimer />
            <EmptyState
              title="Nothing to estimate yet"
              body="The statement is built from rent you have marked received and expenses you have recorded."
              action={
                <Button asChild>
                  <Link href={building ? `/buildings/${building.id}` : "/"}>
                    {building
                      ? `Go to ${building.name}`
                      : "Go to your buildings"}
                  </Link>
                </Button>
              }
            />
          </div>
        </PageBody>
      </>
    );
  }

  const buildingNames = new Map(
    inputs.buildings.map((candidate) => [candidate.id, candidate.name]),
  );
  const unitCounts = new Map(
    inputs.buildings.map((candidate) => [candidate.id, candidate.unitCount]),
  );
  const plansById = new Map(plans.map((plan) => [plan.id, plan]));
  const unmarked = buildings.reduce(
    (sum, candidate) => sum + candidate.unmarkedRentPeriods,
    0,
  );

  return (
    <>
      {header}
      <PageBody>
        <div className="flex flex-col gap-5">
          <TaxDisclaimer />

          {/* Below `lg` the liability comes first: the figure someone came
              for, then the statement that checks it. */}
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_336px] lg:grid-rows-[auto_1fr]">
            <div className="lg:col-start-2 lg:row-start-1">
              <LiabilityCard
                year={year}
                liability={result.liability}
                rateBps={inputs.rateBps}
                newBasisCents={s.newBasisCents}
              />
            </div>

            <div className="flex flex-col gap-5 lg:col-start-1 lg:row-span-2 lg:row-start-1">
              <section
                aria-labelledby="statement-heading"
                className="flex flex-col gap-3 rounded-lg border border-border-card bg-surface-card p-5"
              >
                <div className="flex flex-col gap-1">
                  <h2
                    id="statement-heading"
                    className="text-md leading-tight font-semibold text-text-primary"
                  >
                    {year} rental income statement
                  </h2>
                  <p className="text-xs leading-snug text-text-muted">
                    Schedule E ·{" "}
                    {building
                      ? building.name
                      : `all ${inputs.buildings.length} buildings`}
                  </p>
                </div>
                {unmarked > 0 ? (
                  <p className="text-xs leading-snug text-text-tertiary">
                    {unmarked === 1
                      ? "1 earlier month of rent was never marked"
                      : `${unmarked} earlier months of rent were never marked`}
                    , so {unmarked === 1 ? "it is" : "they are"} not counted.
                    Mark them on the rent roll.
                  </p>
                ) : null}
                <IncomeStatement
                  statement={s}
                  buildingNames={buildingNames}
                  categoryLabels={inputs.categoryLabels}
                  buildingId={building?.id ?? null}
                />
              </section>

              <section
                aria-labelledby="decisions-heading"
                className="flex flex-col gap-2 rounded-lg border border-border-card bg-surface-card p-5"
              >
                <h2
                  id="decisions-heading"
                  className="text-md leading-tight font-semibold text-text-primary"
                >
                  Repair or improvement?
                </h2>
                <p className="max-w-prose text-sm leading-normal text-text-tertiary">
                  A repair comes off this year’s income in full. An improvement
                  is capitalized and recovered over years. How an item is
                  classified depends on what the work does, and it is a call to
                  confirm with a CPA.
                  {result.deMinimisCents !== null
                    ? ` An item at or under the ${formatMoney(result.deMinimisCents)} de minimis threshold is deducted in full either way.`
                    : null}
                </p>
                {plannedThisYear ? (
                  <ul className="@container flex flex-col divide-y divide-border-divider">
                    {result.decisions.map((decision) => {
                      const plan = plansById.get(decision.plan.id)!;
                      const units = unitCounts.get(plan.buildingId) ?? 0;

                      return (
                        <DecisionRow
                          key={plan.id}
                          planId={plan.id}
                          name={plan.label}
                          buildingName={
                            building
                              ? null
                              : (buildingNames.get(plan.buildingId) ?? null)
                          }
                          scope={
                            units > 1 ? (plan.unitLabel ?? "Shared") : null
                          }
                          costCents={plan.costCents}
                          classification={plan.classification}
                          effect={
                            decision.liabilityEffectCents === null
                              ? {
                                  cents: decision.taxableEffectCents,
                                  of: "taxable",
                                }
                              : {
                                  cents: decision.liabilityEffectCents,
                                  of: "liability",
                                }
                          }
                          year={year}
                          underDeMinimis={decision.underDeMinimis}
                          thresholdCents={result.deMinimisCents}
                        />
                      );
                    })}
                  </ul>
                ) : (
                  <p className="pt-1 text-sm text-text-secondary">
                    No planned work this year.
                  </p>
                )}
              </section>
            </div>

            {plannedThisYear ? (
              <div className="lg:col-start-2 lg:row-start-2">
                <TimingLevers
                  year={year}
                  levers={result.levers}
                  taxableCents={s.taxableCents}
                  deMinimisFor={(y) => deMinimisFor(inputs.deMinimis, y)}
                  buildingNames={building ? null : buildingNames}
                />
              </div>
            ) : null}
          </div>
        </div>
      </PageBody>
    </>
  );
}
