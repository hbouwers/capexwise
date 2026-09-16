import Link from "next/link";
import type { ReactNode } from "react";

import { DateValue } from "@/components/date-value";
import { Money } from "@/components/money";
import { ScopeLabel } from "@/components/scope-label";
import { PriorityPill } from "@/components/tasks/priority-pill";
import {
  CheckoffRow,
  ConfirmationToggle,
} from "@/components/tasks/task-controls";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { type CalendarDate, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import {
  daysLate,
  dueNote,
  dueNoteText,
  frequencyLabel,
  PRIORITY_LABELS,
} from "@/lib/tasks";
import type { Assignee, TaskRecord } from "@/server/queries/tasks";

/**
 * Maintenance's three tables (`docs/ui/screens/maintenance.md`): each a
 * `DataTable` of `components.md` §7 with the spec's column priorities, so below
 * `md` the folded columns join the task's note line as text and the table
 * stays a table.
 *
 * **Some columns fold at `xl` too.** From `md` to `xl` the rail takes 240px
 * of a laptop's width, and seven fixed columns would leave the task's name a
 * sliver; the columns that matter least to the tab — Trade, Repeats, Cost, an
 * assignee beside its status — join the note line there instead, as text.
 *
 * Rendered on the server. The checkbox row and the confirmation toggle are the
 * client parts, and both hand their result back to the server.
 */

/** What a row needs of where its task is. */
export type TaskPlace = {
  buildingName: string;
  /** The unit's label or `Shared`, on a building with more than one unit. */
  scope: string | null;
  /** Today where the building is. */
  today: CalendarDate;
};

export function assigneeText(assignee: Assignee): string {
  if (assignee === null) return "Unassigned";
  if (assignee.kind === "contact") return assignee.name;
  return assignee.kind === "me" ? "Me" : "A member";
}

function AssigneeValue({ assignee }: { assignee: Assignee }) {
  return (
    <span
      className={cn(
        "text-sm",
        assignee === null ? "text-text-muted" : "text-text-primary",
      )}
    >
      {assigneeText(assignee)}
    </span>
  );
}

/** The building's name, with its scope beneath when the building has one. */
function BuildingValue({ place }: { place: TaskPlace }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="text-sm text-text-primary">{place.buildingName}</span>
      {place.scope ? <ScopeLabel>{place.scope}</ScopeLabel> : null}
    </span>
  );
}

function placeText(place: TaskPlace): string {
  return place.scope
    ? `${place.buildingName} · ${place.scope}`
    : place.buildingName;
}

/** Below which width a column is folded into the note line. */
type Fold = "md" | "xl";

const FOLDED: Record<Fold, string> = {
  md: "hidden md:table-cell",
  xl: "hidden xl:table-cell",
};

/** A header cell, hidden below its fold. */
function Head({
  children,
  fold,
  className,
}: {
  children?: ReactNode;
  fold?: Fold;
  className?: string;
}) {
  return (
    <TableHead className={cn(fold && FOLDED[fold], className)}>
      {children ? <span className="field-label">{children}</span> : null}
    </TableHead>
  );
}

/** A body cell, hidden below its fold. */
function Cell({
  children,
  fold,
  className,
}: {
  children?: ReactNode;
  fold?: Fold;
  className?: string;
}) {
  return (
    <TableCell
      className={cn(
        "align-top whitespace-normal",
        fold && FOLDED[fold],
        className,
      )}
    >
      {children}
    </TableCell>
  );
}

/**
 * The `primary` cell: the title — plain text until the task modal makes it a
 * link to `?task={id}` (#114) — a note line at every width, and the folded
 * columns' text beneath it below `md`.
 */
function TaskCell({
  title,
  note,
  folded,
  className,
}: {
  title: string;
  note?: string | null;
  /** Each hidden column's text, in column order, and the width it folds at. */
  folded: [Fold, string | null][];
  className?: string;
}) {
  const text = (widths: Fold[]) =>
    folded
      .filter(([fold, value]) => value && widths.includes(fold))
      .map(([, value]) => value)
      .join(" · ");
  const wide = text(["xl"]);

  return (
    <Cell className={className}>
      <span className="block text-sm font-medium text-text-primary">
        {title}
      </span>
      {note ? (
        <span className="block text-2xs leading-snug text-text-muted">
          {note}
        </span>
      ) : null}
      <span className="block text-2xs leading-snug text-text-muted md:hidden">
        {text(["md", "xl"])}
      </span>
      {wide ? (
        <span className="hidden text-2xs leading-snug text-text-muted md:block xl:hidden">
          {wide}
        </span>
      ) : null}
    </Cell>
  );
}

function costText(cents: number | null): string {
  return cents === null ? "—" : formatMoney(cents);
}

function CostValue({ cents }: { cents: number | null }) {
  return cents === null ? (
    <span className="text-sm text-text-muted">—</span>
  ) : (
    <Money cents={cents} className="text-sm text-text-primary" />
  );
}

/** A tab with nothing in it: one line, no action (`maintenance.md`, states). */
export function EmptyTab({ children }: { children: string }) {
  return (
    <p className="px-5 py-8 text-sm text-text-tertiary sm:text-center">
      {children}
    </p>
  );
}

/**
 * Unscheduled: work waiting for a date, high priority first and then oldest
 * first. Nothing here can be checked off — a job with no date is completed
 * from the task modal, which asks when (#114).
 */
export function UnscheduledTable({
  tasks,
  places,
}: {
  tasks: TaskRecord[];
  places: Map<string, TaskPlace>;
}) {
  const order = { high: 0, normal: 1, low: 2 } as const;
  const rows = [...tasks].sort(
    (a, b) =>
      order[a.priority] - order[b.priority] ||
      a.addedOn.localeCompare(b.addedOn) ||
      a.id.localeCompare(b.id),
  );

  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <Head fold="md" className="w-24 pl-5">
            Priority
          </Head>
          <Head className="max-md:pl-5">Task</Head>
          <Head fold="md" className="w-40">
            Building
          </Head>
          <Head fold="xl" className="w-32">
            Trade
          </Head>
          <Head className="w-24 text-right max-md:pr-5">Est. cost</Head>
          <Head fold="md" className="w-32 pr-5">
            Assignee
          </Head>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((task) => {
          const place = places.get(task.id)!;
          const folded: [Fold, string | null][] = [
            ["md", PRIORITY_LABELS[task.priority]],
            ["md", placeText(place)],
            ["xl", task.tradeLabel],
            ["md", assigneeText(task.assignee)],
          ];

          return (
            <TableRow
              key={task.id}
              className="border-border-divider hover:bg-hover-fill-subtle"
            >
              <Cell fold="md" className="pl-5">
                <PriorityPill priority={task.priority} />
              </Cell>
              <TaskCell
                title={task.title}
                note={`added ${formatDate(task.addedOn, "short")}`}
                folded={folded}
                className="max-md:pl-5"
              />
              <Cell fold="md">
                <BuildingValue place={place} />
              </Cell>
              <Cell fold="xl">
                <span
                  className={cn(
                    "text-sm",
                    task.tradeLabel ? "text-text-primary" : "text-text-muted",
                  )}
                >
                  {task.tradeLabel ?? "—"}
                </span>
              </Cell>
              <Cell className="text-right max-md:pr-5">
                <CostValue cents={task.estCostCents} />
              </Cell>
              <Cell fold="md" className="pr-5">
                <AssigneeValue assignee={task.assignee} />
              </Cell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** The Scheduled tab's three groups, in the order they are read. */
export type ScheduledGroups = {
  overdue: TaskRecord[];
  nextThirtyDays: TaskRecord[];
  later: TaskRecord[];
};

const GROUP_LABELS: [keyof ScheduledGroups, string][] = [
  ["overdue", "Overdue"],
  ["nextThirtyDays", "Next 30 days"],
  ["later", "Later"],
];

/** The Scheduled table's columns below `md`, from `md` to `xl`, and wider. */
const SPANS = [
  { span: 3, className: "md:hidden" },
  { span: 5, className: "hidden md:table-cell xl:hidden" },
  { span: 8, className: "hidden xl:table-cell" },
];

/**
 * Scheduled: booked work in three `<tbody>` groups — Overdue, Next 30 days and
 * Later — each by date, so a phone still reads Overdue first. Checking a row
 * completes the task on today's date at its estimate.
 */
export function ScheduledTable({
  groups,
  places,
}: {
  groups: ScheduledGroups;
  places: Map<string, TaskPlace>;
}) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-12 pl-5">
            <span className="sr-only">Done</span>
          </TableHead>
          <Head>Task</Head>
          <Head fold="md" className="w-40">
            Building
          </Head>
          <Head fold="xl" className="w-32">
            Assignee
          </Head>
          <Head fold="xl" className="w-28">
            Repeats
          </Head>
          <Head className="w-24 text-right max-md:pr-5">Date</Head>
          <Head fold="xl" className="w-24 text-right">
            Cost
          </Head>
          <Head fold="md" className="w-48 pr-5">
            Status
          </Head>
        </TableRow>
      </TableHeader>
      {GROUP_LABELS.map(([key, label]) =>
        groups[key].length === 0 ? null : (
          <TableBody key={key}>
            <TableRow className="border-border-divider bg-surface-subtle hover:bg-surface-subtle">
              {/* One heading per width, each spanning the columns shown at
                  it: a span wider than those makes columns out of nothing. */}
              {SPANS.map(({ span, className }) => (
                <th
                  key={span}
                  scope="rowgroup"
                  colSpan={span}
                  className={cn("px-5 py-2 text-left", className)}
                >
                  <span className="field-label">{label}</span>
                </th>
              ))}
            </TableRow>
            {groups[key].map((task) => (
              <ScheduledRow
                key={task.id}
                task={task}
                place={places.get(task.id)!}
              />
            ))}
          </TableBody>
        ),
      )}
    </Table>
  );
}

function ScheduledRow({ task, place }: { task: TaskRecord; place: TaskPlace }) {
  const due = task.dueDate!;
  const note = dueNote(due, place.today, 0);
  const assigned = task.assignee !== null;
  const status = !assigned
    ? null
    : task.confirmedOn
      ? "Confirmed"
      : "Awaiting confirmation";

  const folded: [Fold, string | null][] = [
    ["md", placeText(place)],
    ["xl", assigneeText(task.assignee)],
    ["xl", frequencyLabel(task.recurrenceMonths)],
    ["xl", task.estCostCents === null ? null : costText(task.estCostCents)],
    ["md", status],
  ];

  return (
    <CheckoffRow taskId={task.id} title={task.title} spans={SPANS}>
      <TaskCell title={task.title} folded={folded} />
      <Cell fold="md">
        <BuildingValue place={place} />
      </Cell>
      <Cell fold="xl">
        <AssigneeValue assignee={task.assignee} />
      </Cell>
      <Cell fold="xl">
        <span className="text-sm text-text-primary">
          {frequencyLabel(task.recurrenceMonths)}
        </span>
      </Cell>
      <Cell className="text-right max-md:pr-5">
        <DateValue
          date={due}
          form="short"
          className="text-sm text-text-primary"
        />
        {note?.kind === "late" ? (
          <span className="block text-2xs leading-snug text-status-danger">
            {dueNoteText(note)}
          </span>
        ) : null}
      </Cell>
      <Cell fold="xl" className="text-right">
        <CostValue cents={task.estCostCents} />
      </Cell>
      <Cell fold="md" className="pr-5">
        {assigned ? (
          <ConfirmationToggle
            taskId={task.id}
            title={task.title}
            confirmedOn={task.confirmedOn}
          />
        ) : null}
      </Cell>
    </CheckoffRow>
  );
}

/**
 * Done: most recently completed first — the last twelve months, or every one
 * with `?done=all` — and how late each was.
 */
export function DoneTable({
  tasks,
  places,
  footer,
}: {
  tasks: TaskRecord[];
  places: Map<string, TaskPlace>;
  /** `Show earlier`, or `Show the last 12 months`, beneath the table. */
  footer: ReactNode;
}) {
  const rows = [...tasks].sort(
    (a, b) =>
      b.completedOn!.localeCompare(a.completedOn!) || b.id.localeCompare(a.id),
  );

  return (
    <>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <Head className="pl-5">Task</Head>
            <Head fold="md" className="w-40">
              Building
            </Head>
            <Head fold="xl" className="w-32">
              Assignee
            </Head>
            <Head fold="md" className="w-32">
              Completed
            </Head>
            <Head className="w-28 pr-5 text-right">Cost</Head>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((task) => {
            const place = places.get(task.id)!;
            const completedOn = task.completedOn!;
            const late = daysLate({ dueDate: task.dueDate, completedOn });
            const lateText =
              late === null ? null : dueNoteText({ kind: "late", days: late });

            const folded: [Fold, string | null][] = [
              ["md", placeText(place)],
              ["xl", assigneeText(task.assignee)],
              ["md", `done ${formatDate(completedOn, "short")}`],
              ["md", lateText],
            ];

            return (
              <TableRow
                key={task.id}
                className="border-border-divider hover:bg-hover-fill-subtle"
              >
                <TaskCell title={task.title} folded={folded} className="pl-5" />
                <Cell fold="md">
                  <BuildingValue place={place} />
                </Cell>
                <Cell fold="xl">
                  <AssigneeValue assignee={task.assignee} />
                </Cell>
                <Cell fold="md">
                  <DateValue
                    date={completedOn}
                    className="text-sm text-text-primary"
                  />
                  {lateText ? (
                    <span className="block text-2xs leading-snug text-status-danger">
                      {lateText}
                    </span>
                  ) : null}
                </Cell>
                <Cell className="pr-5 text-right">
                  <CostValue cents={task.actualCostCents} />
                </Cell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {footer}
    </>
  );
}

/** A link beneath a table, keeping the page's other params. */
export function TableFootLink({
  href,
  children,
}: {
  href: string;
  children: string;
}) {
  return (
    <div className="border-t border-border-divider px-5 py-3">
      <Link
        href={href}
        scroll={false}
        className="text-sm text-accent underline-offset-4 hover:underline"
      >
        {children}
      </Link>
    </div>
  );
}
