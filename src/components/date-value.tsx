import { cn } from "@/lib/cn";
import { type CalendarDate, type DateForm, formatDate } from "@/lib/dates";

/**
 * A date or a year, in the mono (`docs/ui/components.md` §6). Always absolute —
 * every date on this product is a planning date, and "3 days ago" is a status
 * that sits beside a date, never in place of one.
 *
 * A date is a `YYYY-MM-DD` string, as the column is read; a year is the integer
 * an install year is stored as. They are separate props because they are
 * separate facts: an estimated install year is not a date in January
 * (ADR-0005), and there is no path from one to the other here.
 *
 * Rendered as a `<time>` carrying the machine-readable value, so the text can
 * be `Sep 14` without the year being lost.
 */
export function DateValue(
  props: (
    | { date: CalendarDate; form?: DateForm; year?: never }
    | { year: number; date?: never; form?: never }
  ) & { className?: string },
) {
  const className = cn("numeric", props.className);

  if (props.date === undefined) {
    return (
      <time dateTime={String(props.year)} className={className}>
        {props.year}
      </time>
    );
  }

  return (
    <time
      dateTime={props.form === "month" ? props.date.slice(0, 7) : props.date}
      className={className}
    >
      {formatDate(props.date, props.form)}
    </time>
  );
}
