import type { ReactNode } from "react";

import { ConfirmItem } from "@/components/buildings/confirm-item";
import {
  EquipmentFilter,
  EquipmentFilterClear,
  type ScopeChip,
} from "@/components/buildings/equipment-filter";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { DateValue } from "@/components/date-value";
import { EmptyState } from "@/components/empty-state";
import {
  LifeBar,
  LifeStatusBadge,
  lifeStatusLabel,
} from "@/components/life-bar";
import { Money } from "@/components/money";
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
import { compareUnitLabels } from "@/lib/buildings";
import { CAPITAL_ITEM_GROUP_LABELS } from "@/lib/capital-items";
import { cn } from "@/lib/cn";
import type { CalendarDate } from "@/lib/dates";
import {
  ageInYears,
  lifeStatus,
  lifeUsedPercent,
  replacementYear,
} from "@/lib/forecast/life";
import { formatMoney } from "@/lib/money";
import type { EquipmentItem } from "@/server/queries/capital-items";

/** What the table is filtered to, from the page's search params. */
export type EquipmentView = {
  /** `shared`, a unit's id, or null for every scope. */
  scope: string | null;
  estimatedOnly: boolean;
};

type Unit = { id: string; label: string; retired: boolean };

/** A run of rows under one scope heading — or the only run, unheaded. */
type Group = { key: string; label: string; items: EquipmentItem[] };

/**
 * Equipment & capital items (`docs/ui/screens/building-detail.md`): every item
 * in service on the building, with where it is in its life. A `DataTable` of
 * `components.md` §7, with the spec's priorities — Item `primary`, Replace
 * `figure`, the rest `fold` — so below `md` the folded values join the item's
 * note line and the table stays a table.
 *
 * **Grouped by scope on a building with more than one unit**: one `<tbody>`
 * per scope, `Shared` first and then each unit in label order, each opened by
 * a `rowgroup` header, and sorted by replacement year within it. A
 * single-unit building shows no scope anywhere (`screens/README.md`). A
 * retired unit that still holds equipment counts as a scope, since its items
 * have to be shown somewhere.
 *
 * Every figure comes from `src/lib/forecast/life.ts`, the rules the forecast
 * reads, so this table and the forecast cannot disagree about a year.
 *
 * Renders on the server. `Confirm` and the filter chips are the client parts,
 * and both hand their result back to the server — a write, or a URL.
 */
export function EquipmentCard({
  items,
  units,
  view,
  thisYear,
  today,
  editable,
  addEquipment,
}: {
  items: EquipmentItem[];
  /** Every unit, retired ones included, in label order. */
  units: Unit[];
  view: EquipmentView;
  thisYear: number;
  today: CalendarDate;
  /** False on an archived or sold building: no `Add equipment`, no `Confirm`. */
  editable: boolean;
  /** The `Add equipment` control, or null where it is not offered. */
  addEquipment: ReactNode;
}) {
  if (items.length === 0) {
    return (
      <section id="equipment" className="scroll-mt-6 lg:scroll-mt-20">
        <EmptyState
          title="No equipment yet"
          body={
            editable
              ? "Check off what the building has, and we estimate each install year to start from."
              : "No equipment was recorded for this building."
          }
          action={addEquipment}
        />
      </section>
    );
  }

  const withItems = new Set(items.map((item) => item.unitId));
  const scopedUnits = units.filter(
    (unit) => !unit.retired || withItems.has(unit.id),
  );
  const showScope = scopedUnits.length > 1;

  // The filter the table applies. A unit the page accepted but that offers no
  // chip — retired, with nothing on it, from a link older than the retirement
  // — is no filter, as a unit of another building is: filtering to it would
  // empty the table with nothing pressed to say why. A single-unit building
  // has no scope to filter by at all.
  const scope =
    showScope &&
    (view.scope === "shared" ||
      scopedUnits.some((unit) => unit.id === view.scope))
      ? view.scope
      : null;

  const inScope = (item: EquipmentItem) =>
    scope === null ||
    (scope === "shared" ? item.unitId === null : item.unitId === scope);
  const inConfidence = (item: EquipmentItem) =>
    !view.estimatedOnly || item.confidence === "estimated";

  const shown = items.filter((item) => inScope(item) && inConfidence(item));
  const audited = items.filter((item) => item.confidence === "audited").length;

  const scopes: ScopeChip[] = showScope
    ? [
        {
          scope: null,
          label: "All",
          count: items.filter(inConfidence).length,
        },
        {
          scope: "shared",
          label: "Shared",
          count: items.filter(
            (item) => item.unitId === null && inConfidence(item),
          ).length,
        },
        ...scopedUnits.map((unit) => ({
          scope: unit.id,
          label: unit.label,
          count: items.filter(
            (item) => item.unitId === unit.id && inConfidence(item),
          ).length,
        })),
      ]
    : [];

  const groups: Group[] = showScope
    ? [
        { key: "shared", label: "Shared", unitId: null },
        ...scopedUnits.map((unit) => ({
          key: unit.id,
          label: unit.label,
          unitId: unit.id,
        })),
      ]
        .map((group) => ({
          key: group.key,
          label: group.label,
          items: sorted(shown.filter((item) => item.unitId === group.unitId)),
        }))
        .filter((group) => group.items.length > 0)
    : [{ key: "all", label: "", items: sorted(shown) }];

  const filterName =
    scope === "shared"
      ? "Shared"
      : (scopedUnits.find((unit) => unit.id === scope)?.label ?? null);
  const filteredTo = [filterName, view.estimatedOnly ? "estimated" : null]
    .filter(Boolean)
    .join(" ");

  const totalCents = shown.reduce(
    (sum, item) => sum + item.replacementCostCents,
    0,
  );

  return (
    <section
      id="equipment"
      aria-labelledby="equipment-heading"
      className="scroll-mt-6 overflow-hidden rounded-lg border border-border-card bg-surface-card lg:scroll-mt-20"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border-divider px-5 py-2.5">
        <div className="flex flex-col gap-1 py-1">
          <h2
            id="equipment-heading"
            className="text-md leading-tight font-semibold text-text-primary"
          >
            Equipment &amp; capital items
          </h2>
          <p className="text-xs leading-snug text-text-muted">
            {items.length === 1 ? "1 item" : `${items.length} items`} ·{" "}
            {audited} audited, {items.length - audited} estimated
          </p>
        </div>
        {addEquipment}
      </div>

      <div className="border-b border-border-divider py-3">
        <EquipmentFilter
          scopes={scopes}
          scope={scope}
          estimatedOnly={view.estimatedOnly}
          estimatedCount={
            items.filter(
              (item) => inScope(item) && item.confidence === "estimated",
            ).length
          }
        />
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-start gap-3 px-5 py-8 sm:items-center sm:text-center">
          <p className="text-sm font-medium text-text-primary">
            No {filteredTo} items
          </p>
          <EquipmentFilterClear />
        </div>
      ) : (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">
                <span className="field-label">Item</span>
              </TableHead>
              <TableHead className="hidden w-52 md:table-cell">
                <span className="field-label">Installed</span>
              </TableHead>
              <TableHead className="hidden w-36 md:table-cell">
                <span className="field-label">Age vs life</span>
              </TableHead>
              <TableHead className="w-20 text-right max-md:pr-5">
                <span className="field-label">Replace</span>
              </TableHead>
              <TableHead className="hidden w-28 text-right md:table-cell">
                <span className="field-label">Est. cost</span>
              </TableHead>
              <TableHead className="hidden w-32 pr-5 md:table-cell">
                <span className="field-label">Status</span>
              </TableHead>
            </TableRow>
          </TableHeader>

          {groups.map((group) => (
            <TableBody key={group.key}>
              {showScope ? (
                <TableRow className="border-border-divider bg-surface-subtle hover:bg-surface-subtle">
                  {/* Two headings, each spanning the columns shown at its
                      width: a span of six below `md`, where two columns show,
                      makes four more columns out of nothing, and the item's
                      name is squeezed to a sliver sharing the width with them. */}
                  <th
                    scope="rowgroup"
                    colSpan={2}
                    className="px-5 py-2 text-left font-normal md:hidden"
                  >
                    <ScopeLabel>{group.label}</ScopeLabel>
                  </th>
                  <th
                    scope="rowgroup"
                    colSpan={6}
                    className="hidden px-5 py-2 text-left font-normal md:table-cell"
                  >
                    <ScopeLabel>{group.label}</ScopeLabel>
                  </th>
                </TableRow>
              ) : null}
              {group.items.map((item) => (
                <Row
                  key={item.id}
                  item={item}
                  thisYear={thisYear}
                  today={today}
                  editable={editable}
                />
              ))}
            </TableBody>
          ))}

          <TableFooter className="bg-surface-subtle">
            <TableRow className="hover:bg-transparent">
              <TableCell className="pl-5 whitespace-normal">
                <span className="block text-sm font-medium text-text-secondary">
                  Total replacement value
                </span>
                <span className="block text-2xs leading-snug font-normal text-text-muted md:hidden">
                  {formatMoney(totalCents)}
                </span>
              </TableCell>
              <TableCell className="hidden md:table-cell" />
              <TableCell className="hidden md:table-cell" />
              <TableCell className="max-md:pr-5" />
              <TableCell className="hidden text-right font-medium md:table-cell">
                <Money cents={totalCents} />
              </TableCell>
              <TableCell className="hidden pr-5 md:table-cell" />
            </TableRow>
          </TableFooter>
        </Table>
      )}

      <p className="border-t border-border-divider px-5 py-3 text-xs leading-snug text-text-muted">
        Estimated install years assume each item is 60% of the way through its
        typical life, and never older than the building. Confirm an item once
        you have read its label — audited items tighten the forecast.
      </p>
    </section>
  );
}

/** Soonest replacement first; then by name, then by id, so one order holds. */
function sorted(items: EquipmentItem[]): EquipmentItem[] {
  return [...items].sort(
    (a, b) =>
      replacementYear(a) - replacementYear(b) ||
      compareUnitLabels(a.label, b.label) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

function Row({
  item,
  thisYear,
  today,
  editable,
}: {
  item: EquipmentItem;
  thisYear: number;
  today: CalendarDate;
  editable: boolean;
}) {
  const estimated = item.confidence === "estimated";
  const status = lifeStatus(item, thisYear);
  const age = ageInYears(item, thisYear);
  const category =
    item.group === null ? null : CAPITAL_ITEM_GROUP_LABELS[item.group];

  // Below `md`, the folded columns as text, in their column order.
  const folded = [
    `${estimated ? "est." : "installed"} ${item.installYear}`,
    `${age} / ${item.expectedLifeYears} yr`,
    formatMoney(item.replacementCostCents),
    lifeStatusLabel(status),
  ].join(" · ");

  const confirm =
    editable && estimated ? (
      <ConfirmItem
        itemId={item.id}
        label={item.label}
        estimatedYear={item.installYear}
        today={today}
      />
    ) : null;

  return (
    <TableRow className="border-border-divider hover:bg-hover-fill-subtle">
      <TableCell className="pl-5 align-top whitespace-normal">
        {/* Plain text until the item editor makes it a button (#125). */}
        <span className="block truncate text-sm font-medium text-text-primary">
          {item.label}
        </span>
        {category ? (
          <span className="block text-2xs leading-snug text-text-muted max-md:hidden">
            {category}
          </span>
        ) : null}
        <span className="block text-2xs leading-snug text-text-muted md:hidden">
          {category ? `${category} · ` : null}
          {folded}
        </span>
        {/* The Installed column is hidden here, and `Confirm` with it. Until
            the editor carries it (#125), it moves under the item. */}
        {confirm ? <span className="block md:hidden">{confirm}</span> : null}
      </TableCell>
      <TableCell className="hidden align-top md:table-cell">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <DateValue
            year={item.installYear}
            className={cn(
              "text-sm",
              estimated ? "text-text-muted" : "text-text-primary",
            )}
          />
          <ConfidenceBadge confidence={item.confidence} />
          {confirm}
        </span>
      </TableCell>
      <TableCell className="hidden align-top md:table-cell">
        <LifeBar
          age={age}
          life={item.expectedLifeYears}
          percent={lifeUsedPercent(item, thisYear)}
          status={status}
          className="min-h-5"
        />
      </TableCell>
      <TableCell className="text-right align-top max-md:pr-5">
        <DateValue
          year={replacementYear(item)}
          className="text-sm text-text-primary"
        />
      </TableCell>
      <TableCell className="hidden text-right align-top md:table-cell">
        <Money
          cents={item.replacementCostCents}
          className="text-sm text-text-primary"
        />
      </TableCell>
      <TableCell className="hidden pr-5 align-top md:table-cell">
        <LifeStatusBadge status={status} />
      </TableCell>
    </TableRow>
  );
}
