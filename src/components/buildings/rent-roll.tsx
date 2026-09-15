import Link from "next/link";

import { hrefFor, MonthSwitcher } from "@/components/buildings/month-switcher";
import { RentControls } from "@/components/buildings/rent-controls";
import { Money } from "@/components/money";
import { StatusBadge } from "@/components/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { rentState, rentTotals, unmarkedLine } from "@/lib/rent";
import type { RentRoll, RentRollRow } from "@/server/queries/rent-periods";

/**
 * Units & rent (`docs/ui/screens/building-detail.md`): PRD F1's rent roll and
 * its Paid checkoff, a month at a time. The table is the rent roll of
 * `docs/ui/components.md` §7, with the priorities the spec gives its columns —
 * Unit `primary`, Expected `fold`, Received `figure`, Paid `control` — so
 * below `md` the expected amount moves into the unit's note line and the
 * table stays a table.
 *
 * It renders on the server from the rent roll's own read; the controls in
 * each row are the only client part, and they refresh the page after every
 * write rather than computing anything themselves.
 *
 * An archived or sold building's roll has no Paid column: it is kept for its
 * history, and nothing on it can be marked (`building-detail.md`, states).
 */
export function RentRollCard({
  buildingId,
  roll,
}: {
  buildingId: string;
  roll: RentRoll;
}) {
  const { month, range, today, editable } = roll;
  const past = month < range.current;
  const periods = roll.rows.flatMap((row) => (row.period ? [row.period] : []));
  const totals = rentTotals(periods);

  return (
    <section
      id="units"
      aria-labelledby="units-heading"
      className="scroll-mt-6 overflow-hidden rounded-lg border border-border-card bg-surface-card lg:scroll-mt-20"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border-divider px-5 py-2.5">
        <h2
          id="units-heading"
          className="text-md leading-tight font-semibold text-text-primary"
        >
          Units &amp; rent
        </h2>
        <MonthSwitcher buildingId={buildingId} month={month} range={range} />
      </div>

      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-5">
              <span className="field-label">Unit</span>
            </TableHead>
            <TableHead className="hidden w-32 text-right md:table-cell">
              <span className="field-label">Expected</span>
            </TableHead>
            <TableHead
              className={
                editable
                  ? "w-28 text-right md:w-44"
                  : "w-32 pr-5 text-right md:w-44"
              }
            >
              <span className="field-label">Received</span>
            </TableHead>
            {editable ? (
              <TableHead className="w-30 pr-5 text-right md:w-56">
                <span className="field-label">Paid</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>

        <TableBody>
          {roll.rows.map((row) => (
            <TableRow
              key={row.unit.id}
              className="border-border-divider hover:bg-hover-fill-subtle"
            >
              <TableCell className="pl-5 align-top whitespace-normal">
                <span className="block truncate text-sm font-medium text-text-primary">
                  {row.unit.label}
                </span>
                <Note row={row} />
              </TableCell>
              <TableCell className="hidden text-right align-top md:table-cell">
                {row.period && !row.period.vacant ? (
                  <Money cents={row.period.amountExpectedCents} />
                ) : (
                  <span className="text-sm text-text-muted">—</span>
                )}
              </TableCell>
              <TableCell
                className={`text-right align-top whitespace-normal ${editable ? "" : "pr-5"}`}
              >
                <Received row={row} past={past} editable={editable} />
              </TableCell>
              {editable ? (
                <TableCell className="pr-5 align-top">
                  {row.unit.status === "retired" && !row.period ? null : (
                    <RentControls
                      context={{
                        unitId: row.unit.id,
                        unitLabel: row.unit.label,
                        month,
                        today,
                      }}
                      period={row.period}
                      rentCents={row.unit.rentCents}
                    />
                  )}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>

        <TableFooter className="bg-surface-subtle">
          <TableRow className="hover:bg-transparent">
            <TableCell className="pl-5 whitespace-normal">
              <span className="block text-sm font-medium text-text-secondary">
                Total
              </span>
              <span className="block text-2xs leading-snug font-normal text-text-muted md:hidden">
                Expected {formatMoney(totals.expectedCents)}
              </span>
            </TableCell>
            <TableCell className="hidden text-right font-medium md:table-cell">
              <Money cents={totals.expectedCents} />
            </TableCell>
            <TableCell
              className={`text-right font-medium ${editable ? "" : "pr-5"}`}
            >
              <Money cents={totals.receivedCents} />
            </TableCell>
            {editable ? <TableCell className="pr-5" /> : null}
          </TableRow>
        </TableFooter>
      </Table>

      {roll.unmarked.length > 0 ? (
        <ul className="flex flex-col gap-1 border-t border-border-divider px-5 py-3">
          {roll.unmarked.map((earlier) => (
            <li key={earlier.month} className="text-xs leading-snug">
              <Link
                href={hrefFor(buildingId, earlier.month, range)}
                prefetch={false}
                scroll={false}
                className="text-accent underline-offset-3 hover:underline"
              >
                {unmarkedLine(earlier.month, earlier.count, month)}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * The unit's note line: the lease end on a let unit, `No rent expected` on
 * an empty one, and below `md` the expected amount the hidden column holds.
 */
function Note({ row }: { row: RentRollRow }) {
  const { unit, period } = row;
  const empty = period ? period.vacant : unit.status !== "occupied";

  const note =
    unit.status === "retired"
      ? "Retired"
      : empty
        ? "No rent expected"
        : unit.leaseEnd
          ? `Lease ends ${formatDate(unit.leaseEnd, "month")}`
          : null;
  const expected =
    period && !period.vacant
      ? `Expected ${formatMoney(period.amountExpectedCents)}`
      : null;

  if (note === null && expected === null) return null;

  return (
    <span className="block text-2xs leading-snug text-text-muted">
      {note}
      {expected ? (
        <span className="md:hidden">
          {note ? " · " : null}
          {expected}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The Received cell, in the spec's four row states and the empty ones.
 * `Not marked`, never "unpaid": the product knows nobody said, not that the
 * rent did not come — and it only says so of a month that is over.
 */
function Received({
  row,
  past,
  editable,
}: {
  row: RentRollRow;
  past: boolean;
  editable: boolean;
}) {
  const { unit, period } = row;

  if (!period) {
    return (
      <span className="text-sm text-text-muted">
        {unit.status === "vacant"
          ? "Vacant"
          : editable && unit.rentCents === null
            ? "Rent not entered"
            : "Not recorded"}
      </span>
    );
  }

  const state = rentState(period);

  if (state === "vacant") {
    return <span className="text-sm text-text-muted">Vacant</span>;
  }

  if (state === "not-marked") {
    return (
      <span className="flex flex-col items-end gap-1">
        <span className="text-sm text-text-muted">—</span>
        {past ? <StatusBadge variant="warning">Not marked</StatusBadge> : null}
      </span>
    );
  }

  const received = period.amountReceivedCents!;
  const on = formatDate(period.receivedOn!, "short");

  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className="text-sm text-text-primary">
        <Money cents={received} />
        {state === "partial" ? (
          <span className="text-text-muted">
            {" of "}
            <Money cents={period.amountExpectedCents} />
          </span>
        ) : null}
      </span>
      <span className="text-2xs leading-snug text-text-muted">
        {state === "over"
          ? `${formatMoney(received - period.amountExpectedCents)} more than expected · ${on}`
          : on}
      </span>
      {state === "partial" ? (
        <StatusBadge variant="warning">Partial</StatusBadge>
      ) : null}
    </span>
  );
}
