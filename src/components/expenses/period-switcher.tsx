import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { addMonths, formatDate } from "@/lib/dates";
import {
  type ExpensePeriod,
  type ExpensesView,
  expensesHref,
  periodParam,
  THIS_YEAR,
} from "@/lib/expenses";
import type { MonthRange } from "@/lib/rent";

/**
 * `‹ September 2026 ›` and `This year` (`docs/ui/screens/expenses.md`,
 * filters): the rent roll's switcher, with the year beside it. Links, so a
 * period can be linked to — the dashboard's Cash flow tile and the tax
 * planner's categories both land here with one set — and it keeps the
 * building and category filters as it moves.
 *
 * In the year view the arrows step from the current month, which is where
 * somebody stepping out of the year means to be.
 *
 * Unlike the rent roll's, these may be prefetched: viewing a past month here
 * opens nothing (`getExpensesPage`).
 */
export function PeriodSwitcher({
  period,
  range,
  view,
}: {
  period: ExpensePeriod;
  range: MonthRange;
  /** The page's filters, which every link keeps. */
  view: ExpensesView;
}) {
  const month = period.kind === "month" ? period.month : range.current;
  const previous = addMonths(month, -1);
  const next = addMonths(month, 1);

  const hrefFor = (target: ExpensePeriod) =>
    expensesHref({ ...view, month: periodParam(target, range), expense: null });

  const year = period.kind === "year";

  return (
    <nav aria-label="Period" className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Step
          href={
            year || month > range.earliest
              ? hrefFor({
                  kind: "month",
                  month: year ? range.current : previous,
                })
              : null
          }
          label={
            year
              ? `This month, ${formatDate(range.current, "month-long")}`
              : `Previous month, ${formatDate(previous, "month-long")}`
          }
        >
          <ChevronLeftIcon aria-hidden />
        </Step>
        <p
          aria-live="polite"
          className="min-w-18 text-center text-sm font-medium text-text-primary sm:min-w-32"
        >
          {year ? (
            `${period.year} to date`
          ) : (
            <>
              <span className="sm:hidden">{formatDate(month, "month")}</span>
              <span className="max-sm:hidden">
                {formatDate(month, "month-long")}
              </span>
            </>
          )}
        </p>
        <Step
          href={
            !year && month < range.current
              ? hrefFor({ kind: "month", month: next })
              : null
          }
          label={`Next month, ${formatDate(next, "month-long")}`}
        >
          <ChevronRightIcon aria-hidden />
        </Step>
      </div>
      <Link
        href={expensesHref({ ...view, month: THIS_YEAR, expense: null })}
        aria-current={year ? "page" : undefined}
        scroll={false}
        className={cn(
          "rounded-md px-2.5 py-1.5 text-sm transition-colors",
          year
            ? "bg-accent-fill font-medium text-accent"
            : "text-text-secondary hover:bg-hover-fill",
        )}
      >
        This year
      </Link>
    </nav>
  );
}

function Step({
  href,
  label,
  children,
}: {
  href: string | null;
  label: string;
  children: ReactNode;
}) {
  if (href === null) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        disabled
        aria-label={label}
        className="max-md:size-11"
      >
        {children}
      </Button>
    );
  }

  return (
    <Button variant="ghost" size="icon-sm" asChild className="max-md:size-11">
      <Link href={href} aria-label={label} scroll={false}>
        {children}
      </Link>
    </Button>
  );
}
