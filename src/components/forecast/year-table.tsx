import Link from "next/link";

import { WhatIfMenu } from "@/components/forecast/what-if-menu";
import { Money } from "@/components/money";
import { ScopeLabel } from "@/components/scope-label";
import { StatusBadge, type StatusVariant } from "@/components/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  Replacement,
  ReplacementTag,
  YearOutflow,
} from "@/lib/forecast/outflow";
import { formatMoney } from "@/lib/money";

/** tokens §3's pairs for the four tags. */
const TAGS: Record<ReplacementTag, { label: string; variant: StatusVariant }> =
  {
    overdue: { label: "Overdue", variant: "overdue" },
    due: { label: "Due", variant: "danger" },
    "big-ticket": { label: "Big ticket", variant: "warning" },
    planned: { label: "Planned", variant: "neutral" },
  };

/** Where an item is, for its row's note line. */
export type ItemPlace = {
  buildingId: string;
  buildingName: string;
  /** Null when the building shows no scope: one unit. */
  scope: string | null;
};

/**
 * The selected year (`docs/ui/screens/capex-forecast.md`): every replacement
 * landing in it, largest first, with **the arithmetic that put it there** — so
 * a figure on the chart can be traced to the items and the years it came
 * from. A `DataTable` of `components.md` §7: Item `primary`, Cost `figure`,
 * Why and Tag `fold`, `What if?` `detail`.
 *
 * **The columns fold on the table's own width, not the viewport's.** Beside
 * the rail from `lg` up the column is narrower than a phone's at 1024px, which
 * is `screens/README.md`'s reason regions in a two-column screen use container
 * queries: 36rem, the width the four columns fit in.
 */
export function YearTable({
  bar,
  places,
  deferrals,
}: {
  bar: YearOutflow;
  places: ReadonlyMap<string, ItemPlace>;
  deferrals: [string, number][];
}) {
  const count = bar.replacements.length;

  return (
    <section
      aria-labelledby="year-heading"
      className="@container overflow-hidden rounded-lg border border-border-card bg-surface-card"
    >
      <h2
        id="year-heading"
        className="border-b border-border-divider px-5 py-4 text-md leading-tight font-semibold text-text-primary"
      >
        {bar.year} — {formatMoney(bar.totalCents)} across{" "}
        {count === 1 ? "1 item" : `${count} items`}
      </h2>

      {count === 0 ? (
        <p className="px-5 py-8 text-sm leading-normal text-text-tertiary">
          Nothing is due in {bar.year}.
        </p>
      ) : (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">
                <span className="field-label">Item</span>
              </TableHead>
              <TableHead className="hidden w-[36%] @xl:table-cell">
                <span className="field-label">Why this year</span>
              </TableHead>
              <TableHead className="w-24 text-right @max-xl:pr-5">
                <span className="field-label">Cost</span>
              </TableHead>
              <TableHead className="hidden w-28 @xl:table-cell">
                <span className="field-label">Tag</span>
              </TableHead>
              <TableHead className="hidden w-28 pr-5 @xl:table-cell">
                <span className="sr-only">What if?</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bar.replacements.map((replacement) => {
              const place = places.get(replacement.item.id);
              if (!place) return null;

              const why = whyThisYear(replacement);
              const tag = TAGS[replacement.tag];

              return (
                <TableRow
                  key={`${replacement.item.id}-${replacement.occurrence}`}
                  className="border-border-divider hover:bg-hover-fill-subtle"
                >
                  <TableCell className="pl-5 align-top whitespace-normal">
                    <Link
                      href={`/buildings/${place.buildingId}#equipment`}
                      className="block truncate text-sm font-medium text-text-primary underline-offset-4 hover:underline"
                    >
                      {replacement.item.label}
                    </Link>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs leading-snug text-text-muted">
                      {place.buildingName}
                      {place.scope ? (
                        <ScopeLabel>{place.scope}</ScopeLabel>
                      ) : null}
                    </span>
                    <span className="block text-2xs leading-snug text-text-muted @xl:hidden">
                      {why} · {tag.label}
                    </span>
                  </TableCell>
                  <TableCell className="hidden align-top text-xs leading-snug whitespace-normal text-text-secondary @xl:table-cell">
                    {why}
                  </TableCell>
                  <TableCell className="text-right align-top @max-xl:pr-5">
                    <Money
                      cents={replacement.item.replacementCostCents}
                      className="text-sm text-text-primary"
                    />
                  </TableCell>
                  <TableCell className="hidden align-top @xl:table-cell">
                    <StatusBadge variant={tag.variant}>{tag.label}</StatusBadge>
                  </TableCell>
                  <TableCell className="hidden pr-5 text-right align-top @xl:table-cell">
                    {/* A deferral moves an item's next replacement, and the
                        ones after follow it, so only that one offers it. */}
                    {replacement.occurrence === 0 ? (
                      <WhatIfMenu
                        itemId={replacement.item.id}
                        name={`${replacement.item.label}, ${place.buildingName}`}
                        deferrals={deferrals}
                      />
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

/**
 * `15 yr life · installed 2011 · estimated · 2025–2031`: the item's life and
 * the year it counts from, then what moved it — an estimate's window, a
 * replacement already overdue, a deferral.
 */
export function whyThisYear(replacement: Replacement): string {
  const { item, occurrence, naturalYear, deferredBy, range, year } =
    replacement;

  return [
    `${item.expectedLifeYears} yr life`,
    occurrence === 0
      ? `installed ${item.installYear}`
      : `again after ${naturalYear - item.expectedLifeYears}`,
    item.confidence === "estimated" ? "estimated" : null,
    range ? `${range.from}–${range.to}` : null,
    naturalYear < year - deferredBy ? `due ${naturalYear}` : null,
    deferredBy > 0
      ? `deferred ${deferredBy === 1 ? "1 year" : `${deferredBy} years`}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
