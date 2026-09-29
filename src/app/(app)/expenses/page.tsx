import type { Metadata } from "next";
import Link from "next/link";

import { BuildingSelect } from "@/components/building-select";
import { DeltaValue, Money } from "@/components/money";
import { EmptyState } from "@/components/empty-state";
import { CategorySelect } from "@/components/expenses/category-select";
import { ExpenseModal } from "@/components/expenses/expense-modal";
import { type ExpensePlace, Ledger } from "@/components/expenses/ledger";
import { PeriodSwitcher } from "@/components/expenses/period-switcher";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { StatTile, StatTiles } from "@/components/stat-tile";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import {
  type ExpensesView,
  expensesHref,
  periodBounds,
  periodLabel,
  periodParam,
  spendTotals,
  yearToDateLabel,
} from "@/lib/expenses";
import { formatMoney } from "@/lib/money";
import { rentTotals } from "@/lib/rent";
import { getOrgContext } from "@/server/org-context";
import {
  getExpenseModal,
  getExpensesPage,
  listScheduleECategories,
} from "@/server/queries/expenses";

/**
 * Expenses (`docs/ui/screens/expenses.md`): money out, recorded by hand, by
 * building and Schedule E category — the other half of the dashboard's cash
 * flow and the records half of the tax planner. `?expense=` opens the expense
 * modal over it.
 *
 * **The tiles follow the period and the building, not the category.** They
 * are the period's cash: rent in, spend out, and the difference, which a
 * category would make meaningless on two of the three. The category filters
 * the ledger, whose foot row totals what it shows.
 *
 * Everything a person would link to is in the URL — the period, both filters
 * and the modal — so the whole view is rendered here, on the server.
 */
export const metadata: Metadata = { title: "Expenses — CapExWise" };

const TITLE = "Expenses";
const SUBTITLE = "Money out, by building and Schedule E category";

/** A search param as one string: the first, if it was given more than once. */
function param(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

export default async function ExpensesPage({
  searchParams,
}: PageProps<"/expenses">) {
  // The protection, not a lookup — `(app)/layout.tsx` says why each page makes
  // its own call.
  await getOrgContext();

  const query = await searchParams;
  const [page, categories] = await Promise.all([
    getExpensesPage(param(query.month)),
    listScheduleECategories(),
  ]);

  const building =
    page.buildings.find((b) => b.id === param(query.building)) ?? null;
  const category =
    categories.find((c) => c.slug === param(query.category)) ?? null;

  const view: ExpensesView = {
    month: periodParam(page.period, page.range),
    building: building?.id ?? null,
    category: category?.slug ?? null,
    expense: param(query.expense),
  };
  const modal = await getExpenseModal(view.expense, view.building);

  const hrefFor = (expense: string) => expensesHref({ ...view, expense });

  const addExpense = (
    <Button asChild>
      <Link href={hrefFor("new")} scroll={false}>
        Add expense
      </Link>
    </Button>
  );

  const header = (
    <PageHeader
      title={TITLE}
      subtitle={SUBTITLE}
      actions={page.buildings.length > 0 ? addExpense : null}
    />
  );

  const expenseModal =
    modal && modal.kind !== "not-found" ? (
      <ExpenseModal
        // A fresh modal per expense, so nothing typed for one carries over.
        key={view.expense}
        modal={modal}
        closeHref={expensesHref({ ...view, expense: null })}
        defaults={{ buildingId: view.building, category: view.category }}
      />
    ) : null;
  const notFound =
    modal?.kind === "not-found" ? (
      <p
        role="status"
        className="rounded-md border border-border-card bg-surface-subtle px-4 py-3 text-sm leading-normal text-text-secondary"
      >
        That expense wasn’t found.
      </p>
    ) : null;

  if (page.buildings.length === 0) {
    return (
      <>
        {header}
        <PageBody>
          <div className="flex flex-col gap-6">
            {notFound}
            <EmptyState
              title="No expenses recorded"
              body="Expenses belong to a building. Add one, and record what you spend on it here."
              action={
                <Button asChild>
                  <Link href="/buildings/new">Add a building</Link>
                </Button>
              }
            />
          </div>
          {expenseModal}
        </PageBody>
      </>
    );
  }

  // The building filter applies to every figure on the page.
  const inBuilding = <T extends { buildingId: string }>(rows: T[]) =>
    building === null
      ? rows
      : rows.filter((row) => row.buildingId === building.id);

  const { from, until } = periodBounds(page.period);
  const inPeriod = <T,>(rows: T[], dateOf: (row: T) => string) =>
    rows.filter((row) => dateOf(row) >= from && dateOf(row) < until);

  const yearExpenses = inBuilding(page.expenses);
  const yearRent = inBuilding(page.rent);
  const periodExpenses = inPeriod(yearExpenses, (e) => e.occurredOn);
  const periodRent = inPeriod(yearRent, (r) => r.periodMonth);

  const rent = rentTotals(periodRent);
  const spent = spendTotals(periodExpenses);
  const cashFlow = rent.receivedCents - spent.spentCents;
  const yearCashFlow =
    rentTotals(yearRent).receivedCents - spendTotals(yearExpenses).spentCents;

  const ledger = category
    ? periodExpenses.filter((expense) => expense.category === category.slug)
    : periodExpenses;

  const placeOf = (expense: (typeof ledger)[number]): ExpensePlace => {
    const owner = page.buildings.find((b) => b.id === expense.buildingId)!;
    return {
      buildingName: owner.name,
      scope: owner.units.length > 1 ? (expense.unitLabel ?? "Shared") : null,
    };
  };
  const rowPlaces = new Map(ledger.map((e) => [e.id, placeOf(e)]));

  const label = periodLabel(page.period);
  const monthName =
    page.period.kind === "month"
      ? formatDate(page.period.month, "month-name")
      : null;

  const filters = (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <PeriodSwitcher period={page.period} range={page.range} view={view} />
      <div className="flex flex-col gap-2 sm:flex-row">
        {page.buildings.length > 1 ? (
          <BuildingSelect
            buildings={page.buildings.map(({ id, name }) => ({ id, name }))}
            selected={building?.id ?? null}
          />
        ) : null}
        <CategorySelect categories={categories} selected={view.category} />
      </div>
    </div>
  );

  const tiles = (
    <StatTiles>
      <StatTile
        label="Rent received"
        figure={<Money cents={rent.receivedCents} />}
        sub={`of ${formatMoney(rent.expectedCents)} expected`}
        href="/#buildings"
      />
      <StatTile
        label="Spent"
        figure={<Money cents={spent.spentCents} />}
        sub={spent.count === 1 ? "1 expense" : `${spent.count} expenses`}
        href="#ledger"
      />
      <StatTile
        label="Cash flow"
        figure={<DeltaValue cents={cashFlow} />}
        sub={
          monthName
            ? `${monthName} · ${yearToDateLabel(page.period, page.range)} ${formatMoney(yearCashFlow, { signed: true })}`
            : `${yearToDateLabel(page.period, page.range)} ${page.period.kind === "year" ? page.period.year : ""}`.trim()
        }
        href="#ledger"
      />
    </StatTiles>
  );

  return (
    <>
      {header}
      <PageBody>
        <div className="flex flex-col gap-6">
          {notFound}
          {filters}
          {tiles}

          <section
            id="ledger"
            aria-labelledby="ledger-heading"
            className="flex scroll-mt-24 flex-col gap-4"
          >
            <h2
              id="ledger-heading"
              className="text-md leading-tight font-semibold text-text-primary"
            >
              {category ? `${category.label}, ${label}` : label}
            </h2>
            {ledger.length > 0 ? (
              <div className="overflow-hidden rounded-lg border border-border-card bg-surface-card">
                <Ledger
                  expenses={ledger}
                  places={rowPlaces}
                  today={page.today}
                  hrefFor={hrefFor}
                  total={category ? `${category.label}, ${label}` : label}
                />
              </div>
            ) : category ? (
              <div className="flex flex-col items-start gap-3 rounded-lg border border-border-card bg-surface-card px-5 py-8">
                <p className="text-sm leading-normal text-text-secondary">
                  No {category.label.toLowerCase()} expenses in {label}.
                </p>
                <Button variant="outline" asChild>
                  <Link
                    href={expensesHref({ ...view, category: null })}
                    scroll={false}
                  >
                    Clear filters
                  </Link>
                </Button>
              </div>
            ) : !page.anyRecorded ? (
              <EmptyState
                title="No expenses recorded"
                body="Record what you spend on your buildings, and the dashboard’s cash flow and the tax planner use it."
                action={addExpense}
              />
            ) : (
              <p className="rounded-lg border border-border-card bg-surface-card px-5 py-8 text-sm text-text-tertiary">
                Nothing recorded in {label}.
              </p>
            )}
          </section>
        </div>
        {expenseModal}
      </PageBody>
    </>
  );
}
