import Link from "next/link";

import { Meter } from "@/components/meter";
import { Money } from "@/components/money";
import type { Cents } from "@/lib/money";

export type RunwayRow = {
  year: number;
  /**
   * The items by name, or null for a year with nothing due. Left out on the
   * portfolio, whose rows draw a meter instead.
   */
  items?: string | null;
  cents: Cents;
  href: string;
};

/**
 * `RunwayList` (`docs/ui/components.md` §7): year, what lands in it, and the
 * year's total in compact money, each row a link to that year on the
 * forecast. **Every year is a row, a year with nothing due included** —
 * `Nothing due` is information, and skipping it makes 2029 look like it sits
 * next to 2031.
 *
 * The same component at two scopes. A building's page names each year's
 * items; across the portfolio the names of every building's items would not
 * fit a row, so `meter` draws the year against the largest of the rows
 * instead (`portfolio.md`, Replacement runway), with its total beside it.
 */
export function RunwayList({
  rows,
  meter = false,
}: {
  rows: RunwayRow[];
  meter?: boolean;
}) {
  const largest = Math.max(0, ...rows.map((row) => row.cents));

  return (
    <ul className="flex flex-col">
      {rows.map((row) => (
        <li
          key={row.year}
          className="border-b border-border-divider last:border-b-0"
        >
          <Link
            href={row.href}
            className="flex items-baseline gap-4 px-5 py-3 transition-colors hover:bg-hover-fill-subtle"
          >
            <span className="numeric w-10 shrink-0 text-sm text-text-secondary">
              {row.year}
            </span>
            {meter ? (
              <span className="min-w-0 flex-1 self-center">
                <Meter
                  percent={
                    largest === 0 ? 0 : Math.round((row.cents * 100) / largest)
                  }
                />
              </span>
            ) : (
              <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                {row.items ?? (
                  <span className="text-text-muted">Nothing due</span>
                )}
              </span>
            )}
            <Money
              cents={row.cents}
              form="compact"
              className="min-w-14 shrink-0 text-right text-sm text-text-primary"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
