import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { addMonths, type CalendarDate, formatDate } from "@/lib/dates";
import { type MonthRange, monthParam } from "@/lib/rent";

/**
 * `‹ September 2026 ›` (`docs/ui/screens/building-detail.md`, Units & rent):
 * two links and the month between them, in the `?month=` param so a month can
 * be linked to, reloaded and reached with the back button. `Sep 2026` below
 * `sm`.
 *
 * It stops at both ends of the range rather than wrapping, and an end is a
 * disabled button rather than a missing one, so the month does not shift
 * sideways at the ends. The two steps are 44px below `md`, like the controls
 * in the rows: a year is back-filled a month at a time.
 *
 * **Never prefetched.** Viewing a month opens it (`docs/data-model.md` §4), so
 * a prefetch of the month before would open a month nobody looked at — a
 * whole row of `Not marked` somebody would then have to explain.
 */
export function MonthSwitcher({
  buildingId,
  month,
  range,
}: {
  buildingId: string;
  month: CalendarDate;
  range: MonthRange;
}) {
  const previous = addMonths(month, -1);
  const next = addMonths(month, 1);

  return (
    <nav aria-label="Month" className="flex items-center gap-1">
      <Step
        href={
          month > range.earliest ? hrefFor(buildingId, previous, range) : null
        }
        label={`Previous month, ${formatDate(previous, "month-long")}`}
      >
        <ChevronLeftIcon aria-hidden />
      </Step>
      <p
        aria-live="polite"
        className="min-w-18 text-center text-sm font-medium text-text-primary sm:min-w-32"
      >
        <span className="sm:hidden">{formatDate(month, "month")}</span>
        <span className="max-sm:hidden">{formatDate(month, "month-long")}</span>
      </p>
      <Step
        href={month < range.current ? hrefFor(buildingId, next, range) : null}
        label={`Next month, ${formatDate(next, "month-long")}`}
      >
        <ChevronRightIcon aria-hidden />
      </Step>
    </nav>
  );
}

/**
 * The building's page for `month`. The current month is the page without a
 * param, so the link most people follow is the one they would have typed.
 */
export function hrefFor(
  buildingId: string,
  month: CalendarDate,
  range: MonthRange,
): string {
  const base = `/buildings/${buildingId}`;

  return month === range.current ? base : `${base}?month=${monthParam(month)}`;
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
      <Link href={href} aria-label={label} prefetch={false} scroll={false}>
        {children}
      </Link>
    </Button>
  );
}
