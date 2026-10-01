import Link from "next/link";
import type { ReactNode } from "react";

import { DeltaValue, Money } from "@/components/money";
import { StatementLine } from "@/components/tax/statement-line";
import { formatDate } from "@/lib/dates";
import { expensesHref, THIS_YEAR } from "@/lib/expenses";
import { formatMoney } from "@/lib/money";
import {
  RECOVERY,
  type PlacedInService,
  type RecoveryClass,
} from "@/lib/tax/depreciation";
import {
  MORTGAGE_INTEREST,
  type Source,
  type Statement,
} from "@/lib/tax/statement";

/**
 * The estimated Schedule E (`docs/ui/screens/tax-planner.md`, Income
 * statement): seven lines, each opening to the rows `statement()` built it
 * from, and beneath them what was left out and why. Renders what the module
 * computed and computes nothing; the one arithmetic here is turning
 * half-months into months for a sentence.
 *
 * Deductions carry their sign (`DeltaValue`), so the column reads down to the
 * total the way the form does.
 */
export function IncomeStatement({
  statement,
  buildingNames,
  categoryLabels,
  buildingId,
}: {
  statement: Statement;
  buildingNames: ReadonlyMap<string, string>;
  categoryLabels: ReadonlyMap<string, string>;
  /** The page's building, carried into the links to the ledger. */
  buildingId: string | null;
}) {
  const s = statement;
  const many = s.grossRent.byBuilding.length > 1;
  const nameOf = (id: string) => buildingNames.get(id) ?? "A building";
  const ledger = (category: string) =>
    expensesHref({
      month: THIS_YEAR,
      building: buildingId,
      category,
      expense: null,
    });

  return (
    <div className="flex flex-col">
      <div className="flex flex-col divide-y divide-border-divider">
        <StatementLine
          label="Gross rental income"
          value={<Money cents={s.grossRent.totalCents} />}
        >
          <Rows>
            <Row
              label="Received this year to date"
              value={<Money cents={s.grossRent.receivedCents} />}
            />
            <Row
              label="Expected for the months still to come"
              value={<Money cents={s.grossRent.expectedCents} />}
            />
          </Rows>
          {many ? (
            <Rows>
              {s.grossRent.byBuilding.map((row) => (
                <Row
                  key={row.buildingId}
                  label={nameOf(row.buildingId)}
                  value={
                    <Money cents={row.receivedCents + row.expectedCents} />
                  }
                />
              ))}
            </Rows>
          ) : null}
          <p className="mt-2">
            The months still to come are this one, until it is marked, and the
            rest of the year at each occupied unit’s rent today.
          </p>
        </StatementLine>

        <StatementLine
          label="Operating expenses"
          value={<DeltaValue cents={-s.operatingExpenses.totalCents} />}
        >
          {s.operatingExpenses.byCategory.length === 0 ? (
            <p>No operating expenses recorded this year.</p>
          ) : (
            <Rows>
              {s.operatingExpenses.byCategory.map((category) => (
                <Row
                  key={category.category}
                  label={
                    <Link
                      href={ledger(category.category)}
                      className="underline-offset-2 hover:underline"
                    >
                      {categoryLabels.get(category.category) ??
                        category.category}
                    </Link>
                  }
                  value={<Money cents={category.totalCents} />}
                />
              ))}
            </Rows>
          )}
          <p className="mt-2">
            Recorded this year, net of refunds. Spend recorded as an improvement
            is depreciated instead, below.
          </p>
        </StatementLine>

        <StatementLine
          label="Mortgage interest"
          value={<DeltaValue cents={-s.mortgageInterest.totalCents} />}
        >
          <p>
            {s.mortgageInterest.expenseIds.length === 0 ? (
              "None recorded this year."
            ) : (
              <>
                {count(s.mortgageInterest.expenseIds.length, "payment")}{" "}
                recorded this year in{" "}
                <Link
                  href={ledger(MORTGAGE_INTEREST)}
                  className="underline underline-offset-2"
                >
                  {categoryLabels.get(MORTGAGE_INTEREST) ?? "Mortgage interest"}
                </Link>
                .
              </>
            )}
          </p>
        </StatementLine>

        <StatementLine
          label="Depreciation, existing basis"
          value={<DeltaValue cents={-s.buildingDepreciation.totalCents} />}
        >
          <Rows>
            {s.buildingDepreciation.rows.map((row) =>
              row.kind === "depreciated" ? (
                <Row
                  key={row.buildingId}
                  label={
                    <>
                      {many ? `${nameOf(row.buildingId)}: ` : null}
                      Building value {formatMoney(row.basisCents)} ÷{" "}
                      {years("residential")} · in service{" "}
                      {months(row.halfMonths)} of 12 months
                    </>
                  }
                  value={<Money cents={row.amountCents} />}
                />
              ) : (
                <Row
                  key={row.buildingId}
                  label={
                    <>
                      {many ? `${nameOf(row.buildingId)}: ` : null}
                      {row.missing === "basis"
                        ? "Basis not entered"
                        : "In-service date not entered"}{" "}
                      —{" "}
                      <Link
                        href={`/buildings/${row.buildingId}/edit`}
                        className="underline underline-offset-2"
                      >
                        add it on the building
                      </Link>
                    </>
                  }
                  value={<span className="text-text-muted">Excluded</span>}
                />
              ),
            )}
          </Rows>
          <p className="mt-2">
            The building’s share of the basis, land excluded, over 27.5 years.
            The year it went into service counts from the middle of its month.
          </p>
        </StatementLine>

        <StatementLine
          label="Repairs deducted this year"
          value={<DeltaValue cents={-s.deductedInFull.totalCents} />}
        >
          {s.deductedInFull.rows.length === 0 ? (
            <p>Nothing planned this year is deducted in full.</p>
          ) : (
            <Rows>
              {s.deductedInFull.rows.map((row) => (
                <Row
                  key={`${row.source}-${row.id}`}
                  label={
                    <>
                      {row.label}
                      {many ? `, ${nameOf(row.buildingId)}` : null} ·{" "}
                      {row.reason === "repair"
                        ? "planned as a repair"
                        : `${SOURCE[row.source]}, under the de minimis threshold`}
                    </>
                  }
                  value={<Money cents={row.costCents} />}
                />
              ))}
            </Rows>
          )}
        </StatementLine>

        <StatementLine
          label="Depreciation on improvements"
          value={<DeltaValue cents={-s.improvementDepreciation.totalCents} />}
        >
          {s.improvementDepreciation.rows.length === 0 ? (
            <p>No capitalized improvements recover this year.</p>
          ) : (
            <Rows>
              {s.improvementDepreciation.rows.map((row) => (
                <Row
                  key={`${row.source}-${row.id}`}
                  label={
                    <>
                      {row.label}
                      {many ? `, ${nameOf(row.buildingId)}` : null} ·{" "}
                      {SOURCE[row.source]} · {formatMoney(row.basisCents)} ÷{" "}
                      {years(row.recovery)}, {RECOVERY[row.recovery].convention}{" "}
                      · in service from {placed(row.placedInService)} ·{" "}
                      {months(row.halfMonths)} months this year
                    </>
                  }
                  value={<Money cents={row.amountCents} />}
                />
              ))}
            </Rows>
          )}
          <p className="mt-2">
            Appliances and carpet recover over 5 years with the half-year
            convention; everything else over 27.5 years, mid-month. Work known
            only by its year is taken to go into service in July.
          </p>
        </StatementLine>
      </div>

      <div className="flex items-baseline justify-between gap-4 border-t border-border-section pt-3 text-sm">
        <span className="font-semibold text-text-primary">
          Taxable rental income
        </span>
        {/* A total, not a change: signed only when it is a loss. */}
        <Money
          cents={s.taxableCents}
          className="font-semibold text-text-primary"
        />
      </div>
      {s.buildingDepreciation.excludedCount > 0 ? (
        <p className="pt-1.5 text-xs leading-snug text-text-tertiary">
          Excludes depreciation for{" "}
          {count(s.buildingDepreciation.excludedCount, "building")}.
        </p>
      ) : null}

      <NotCounted statement={s} nameOf={nameOf} many={many} />
    </div>
  );
}

/**
 * What the statement left out, by name (`tax-planner.md`: "What is not
 * decided is named, not counted"). Nothing renders when nothing was.
 */
function NotCounted({
  statement,
  nameOf,
  many,
}: {
  statement: Statement;
  nameOf: (id: string) => string;
  many: boolean;
}) {
  const n = statement.notCounted;
  const where = (row: { buildingId: string }) =>
    many ? `, ${nameOf(row.buildingId)}` : "";

  const groups: { title: string; rows: { key: string; text: string }[] }[] = [
    {
      title: "Planned this year with no call made",
      rows: n.unclassifiedPlans.map((plan) => ({
        key: plan.id,
        text: `${plan.label}${where(plan)}, ${formatMoney(plan.costCents)}`,
      })),
    },
    {
      title: "Recorded this year as Unclassified",
      rows: n.unclassifiedExpenses.map((expense) => ({
        key: expense.id,
        text: `${expense.label}${where(expense)}, ${formatDate(expense.occurredOn, "short")}, ${formatMoney(-expense.amountCents)}`,
      })),
    },
    {
      title:
        "Improvements on a building with no in-service date, so when each started cannot be told",
      rows: [
        ...n.undatedItems.map((item) => ({
          key: item.id,
          text: `${item.label}${where(item)}, installed ${item.installYear}`,
        })),
        ...n.undatedExpenses.map((expense) => ({
          key: expense.id,
          text: `${expense.label}${where(expense)}, ${formatDate(expense.occurredOn)}`,
        })),
      ],
    },
    {
      title:
        "Installed for more than was recorded against them that year, so how much is on the ledger cannot be told",
      rows: n.partlyRecordedItems.map((item) => ({
        key: item.id,
        text: `${item.label}${where(item)}, installed ${item.installYear} for ${formatMoney(item.actualCostCents ?? 0)}`,
      })),
    },
  ].filter((group) => group.rows.length > 0);

  if (groups.length === 0) return null;

  return (
    <section
      aria-labelledby="not-counted-heading"
      className="mt-5 flex flex-col gap-3 rounded-md border border-border-card bg-surface-subtle px-4 py-3"
    >
      <h3
        id="not-counted-heading"
        className="text-sm leading-tight font-medium text-text-primary"
      >
        Not counted in this estimate
      </h3>
      {groups.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <p className="text-xs leading-snug text-text-secondary">
            {group.title}
          </p>
          <ul className="flex flex-col gap-0.5 text-xs leading-snug text-text-tertiary">
            {group.rows.map((row) => (
              <li key={row.key}>{row.text}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

const SOURCE: Record<Source, string> = {
  ledger: "recorded",
  item: "installed",
  plan: "planned",
};

function Rows({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col gap-1.5 py-1">{children}</dl>;
}

function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="min-w-0">{label}</dt>
      <dd className="shrink-0 text-text-secondary">{value}</dd>
    </div>
  );
}

/** `27.5 yr`, `5 yr`. */
function years(recovery: RecoveryClass): string {
  return `${RECOVERY[recovery].months / 12} yr`;
}

/** Half-months as months: `12`, `11.5`. */
function months(halfMonths: number): string {
  return String(halfMonths / 2);
}

/** `Jul 2026`, and `(month assumed)` when nobody said which. */
function placed(at: PlacedInService): string {
  const month = formatDate(
    `${at.year}-${String(at.month).padStart(2, "0")}-01`,
    "month",
  );
  return at.assumed ? `${month} (month assumed)` : month;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
