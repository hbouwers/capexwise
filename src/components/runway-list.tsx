import Link from "next/link";

import { Money } from "@/components/money";
import type { Cents } from "@/lib/money";

export type RunwayRow = {
  year: number;
  /** The items by name, or null for a year with nothing due. */
  items: string | null;
  cents: Cents;
  href: string;
};

/**
 * `RunwayList` (`docs/ui/components.md` §7): year, what lands in it, and the
 * year's total in compact money, each row a link to that year on the
 * forecast. **Every year is a row, a year with nothing due included** —
 * `Nothing due` is information, and skipping it makes 2029 look like it sits
 * next to 2031.
 */
export function RunwayList({ rows }: { rows: RunwayRow[] }) {
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
            <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
              {row.items ?? (
                <span className="text-text-muted">Nothing due</span>
              )}
            </span>
            <Money
              cents={row.cents}
              form="compact"
              className="shrink-0 text-sm text-text-primary"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
