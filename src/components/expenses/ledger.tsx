import Link from "next/link";
import type { ReactNode } from "react";

import { DateValue } from "@/components/date-value";
import { Numeric } from "@/components/numeric";
import { ScopeLabel } from "@/components/scope-label";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { type CalendarDate, formatDate, shortFormIn } from "@/lib/dates";
import { CLASSIFICATION_LABELS, spendTotals } from "@/lib/expenses";
import { formatMoney } from "@/lib/money";
import type { ExpenseRecord } from "@/server/queries/expenses";

/**
 * The ledger (`docs/ui/screens/expenses.md`, the table): a `DataTable` with the
 * spec's column priorities, so below `md` the date, category and
 * classification join the description's note line as text and the table stays
 * a table.
 *
 * **Every amount is signed and exact** — `−$182.47` out, `+$40.00` back.
 * `amount_cents` is the one signed money column in the schema, and this is
 * where the difference is visible; and a ledger a CPA adds up by hand has to
 * show the cents it adds up to, where the rest of the product rounds to the
 * dollar.
 *
 * Rendered on the server; a row's description is the link that opens it.
 */

/** What a row needs of where its expense is. */
export type ExpensePlace = {
  buildingName: string;
  /** The unit's label or `Shared`, on a building with more than one unit. */
  scope: string | null;
};

function Head({
  children,
  folds,
  className,
}: {
  children: ReactNode;
  folds?: boolean;
  className?: string;
}) {
  return (
    <TableHead className={cn(folds && "hidden md:table-cell", className)}>
      <span className="field-label">{children}</span>
    </TableHead>
  );
}

function Cell({
  children,
  folds,
  className,
}: {
  children?: ReactNode;
  folds?: boolean;
  className?: string;
}) {
  return (
    <TableCell
      className={cn(
        "align-top whitespace-normal",
        folds && "hidden md:table-cell",
        className,
      )}
    >
      {children}
    </TableCell>
  );
}

/** What the description cell says when nobody wrote one. */
function titleOf(expense: ExpenseRecord): string {
  return (
    expense.description ??
    expense.taskTitle ??
    expense.itemLabel ??
    expense.categoryLabel
  );
}

export function Ledger({
  expenses,
  places,
  today,
  hrefFor,
  total,
}: {
  expenses: ExpenseRecord[];
  /** Keyed by expense id. */
  places: Map<string, ExpensePlace>;
  /** The page's day, which decides whether a date needs its year. */
  today: CalendarDate;
  hrefFor: (expenseId: string) => string;
  /** The foot row's label: `September 2026`, `2026 to date`. */
  total: string;
}) {
  const { spentCents } = spendTotals(expenses);

  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <Head folds className="w-28 pl-5">
            Date
          </Head>
          <Head className="max-md:pl-5">Description</Head>
          <Head folds className="w-48">
            Category
          </Head>
          <Head folds className="w-32">
            Classification
          </Head>
          <Head className="w-32 pr-5 text-right">Amount</Head>
        </TableRow>
      </TableHeader>
      <TableBody>
        {expenses.map((expense) => {
          const place = places.get(expense.id)!;
          const date = formatDate(
            expense.occurredOn,
            shortFormIn(expense.occurredOn, today),
          );
          const classification = expense.classification
            ? CLASSIFICATION_LABELS[expense.classification]
            : null;
          const linked = [
            expense.itemLabel,
            expense.taskTitle,
            expense.contactName,
          ]
            .filter((part) => part !== null && part !== titleOf(expense))
            .join(" · ");

          return (
            <TableRow
              key={expense.id}
              className="border-border-divider hover:bg-hover-fill-subtle"
            >
              <Cell folds className="pl-5">
                <DateValue
                  date={expense.occurredOn}
                  form={shortFormIn(expense.occurredOn, today)}
                  className="text-sm text-text-primary"
                />
              </Cell>
              <Cell className="max-md:pl-5">
                <Link
                  href={hrefFor(expense.id)}
                  scroll={false}
                  className="block text-sm font-medium text-text-primary underline-offset-4 hover:underline"
                >
                  {titleOf(expense)}
                </Link>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-2xs leading-snug text-text-muted">
                  <span>{place.buildingName}</span>
                  {place.scope ? <ScopeLabel>{place.scope}</ScopeLabel> : null}
                  {linked ? <span>· {linked}</span> : null}
                </span>
                <span className="block text-2xs leading-snug text-text-muted md:hidden">
                  {[date, expense.categoryLabel, classification]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Cell>
              <Cell folds>
                <span className="text-sm text-text-primary">
                  {expense.categoryLabel}
                </span>
              </Cell>
              <Cell folds>
                <span
                  className={cn(
                    "text-sm",
                    expense.classification === "unclassified"
                      ? "text-text-muted"
                      : "text-text-primary",
                  )}
                >
                  {classification ?? ""}
                </span>
              </Cell>
              <Cell className="pr-5 text-right">
                {/* Money out is the negative, so the stored sign is the one
                    the column shows. */}
                <Numeric className="text-sm text-text-primary">
                  {formatMoney(expense.amountCents, {
                    form: "cents",
                    signed: true,
                  })}
                </Numeric>
              </Cell>
            </TableRow>
          );
        })}
      </TableBody>
      <TableFooter>
        <TableRow className="hover:bg-transparent">
          <Cell folds className="pl-5" />
          <Cell className="max-md:pl-5">
            <span className="text-sm font-medium text-text-primary">
              {total}
            </span>
            <span className="block text-2xs leading-snug text-text-muted">
              {expenses.length === 1
                ? "1 expense"
                : `${expenses.length} expenses`}
            </span>
          </Cell>
          <Cell folds />
          <Cell folds />
          <Cell className="pr-5 text-right">
            <Numeric className="text-sm font-medium text-text-primary">
              {formatMoney(spentCents === 0 ? 0 : -spentCents, {
                form: "cents",
                signed: true,
              })}
            </Numeric>
          </Cell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
