import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Label, figure, sub-line (`docs/ui/components.md` §6). **The link is
 * required**: PRD F0 has every figure one click from where it came from, so a
 * tile that could be rendered without one would be the first to lose it. The
 * whole tile is the link — one `<a>`, nothing else interactive inside.
 *
 * `figure` is a node rather than a number so the caller renders it through
 * `Money` or `Numeric`, which own the mono rule and the formatter.
 *
 * **Below `sm` it is a row**, label and sub-line on the left and the figure on
 * the right, so a row of tiles costs a phone a few lines rather than a screen
 * (`docs/ui/screens/README.md`, stat tiles). One component, two layouts.
 */
export function StatTile({
  label,
  figure,
  sub,
  href,
}: {
  label: string;
  figure: ReactNode;
  sub: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-4 rounded-lg border border-border-card bg-surface-card px-4 py-3.5 transition-colors hover:border-hover-border-card sm:flex-col sm:items-start sm:justify-start sm:gap-3 sm:p-5"
    >
      <span className="flex min-w-0 flex-col gap-1.5 sm:contents">
        <span className="field-label">{label}</span>
        <span className="text-xs leading-snug text-text-muted sm:order-last">
          {sub}
        </span>
      </span>
      <span className="shrink-0 text-xl text-text-primary sm:text-2xl">
        {figure}
      </span>
    </Link>
  );
}

/**
 * The row the tiles sit in: `auto-fit` columns no narrower than a tile that
 * holds `$123,456` at the KPI size, which gives five across a wide column and
 * wraps without a breakpoint table — and a single column below `sm`, where each
 * tile is a row.
 */
export function StatTiles({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(168px,1fr))] sm:gap-4">
      {children}
    </div>
  );
}
