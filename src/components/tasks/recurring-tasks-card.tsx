import type { ScopeChip } from "@/components/buildings/equipment-filter";
import { DateValue } from "@/components/date-value";
import { Money } from "@/components/money";
import { ScopeLabel } from "@/components/scope-label";
import { AddTaskForm } from "@/components/tasks/add-task-form";
import { CheckoffRow } from "@/components/tasks/task-controls";
import {
  TaskScopeFilter,
  TaskScopeFilterClear,
} from "@/components/tasks/task-scope-filter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { type CalendarDate, shortFormIn, yearOf } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { dueNote, dueNoteText, frequencyLabel } from "@/lib/tasks";
import type { RecurringTasks, TaskRecord } from "@/server/queries/tasks";

type Unit = { id: string; label: string; retired: boolean };

/** Columns shown below `md` and from `md` up, for the failure line. */
const SPANS = [
  { span: 3, className: "md:hidden" },
  { span: 5, className: "hidden md:table-cell" },
];

/**
 * Recurring tasks (`docs/ui/screens/building-detail.md`): the building's jobs
 * that come round again, each at its next occurrence. A `DataTable` with the
 * spec's priorities — Task `primary`, Next due `figure`, the rest `fold` —
 * grouped by scope on a building with more than one unit and filtered in
 * `?taskScope=`, soonest first within each group.
 *
 * Checking a row completes this occurrence and writes the next; the row comes
 * back with its new date. **The inline add row closes the table**, and on an
 * empty table it is the action. An archived or sold building shows the table
 * with neither.
 */
export function RecurringTasksCard({
  recurring,
  units,
  scope: requestedScope,
  today,
  editable,
  building,
}: {
  recurring: RecurringTasks;
  /** Every unit, retired ones included, in label order. */
  units: Unit[];
  /** `shared`, a unit's id, or null, from the URL. */
  scope: string | null;
  today: CalendarDate;
  editable: boolean;
  building: { id: string; name: string };
}) {
  const tasks = recurring.open;

  const withTasks = new Set(tasks.map((task) => task.unitId));
  const scopedUnits = units.filter(
    (unit) => !unit.retired || withTasks.has(unit.id),
  );
  const showScope = scopedUnits.length > 1;

  // As the equipment table has it: a unit with no chip is no filter.
  const scope =
    showScope &&
    (requestedScope === "shared" ||
      scopedUnits.some((unit) => unit.id === requestedScope))
      ? requestedScope
      : null;

  const inScope = (task: TaskRecord) =>
    scope === null ||
    (scope === "shared" ? task.unitId === null : task.unitId === scope);
  const shown = tasks.filter(inScope);

  const overdue = tasks.filter(
    (task) => task.status === "scheduled" && task.dueDate! < today,
  ).length;
  const thisYear = yearOf(today);
  const doneThisYear = recurring.done.filter(
    (done) => yearOf(done.completedOn) === thisYear,
  ).length;

  const scopes: ScopeChip[] = showScope
    ? [
        { scope: null, label: "All", count: tasks.length },
        {
          scope: "shared",
          label: "Shared",
          count: tasks.filter((task) => task.unitId === null).length,
        },
        ...scopedUnits.map((unit) => ({
          scope: unit.id,
          label: unit.label,
          count: tasks.filter((task) => task.unitId === unit.id).length,
        })),
      ]
    : [];

  const groups = showScope
    ? [
        { key: "shared", label: "Shared", unitId: null as string | null },
        ...scopedUnits.map((unit) => ({
          key: unit.id,
          label: unit.label,
          unitId: unit.id as string | null,
        })),
      ]
        .map((group) => ({
          ...group,
          tasks: sorted(shown.filter((task) => task.unitId === group.unitId)),
        }))
        .filter((group) => group.tasks.length > 0)
    : [{ key: "all", label: "", unitId: null, tasks: sorted(shown) }];

  const filteredTo =
    scope === "shared"
      ? "Shared"
      : (scopedUnits.find((unit) => unit.id === scope)?.label ?? "");

  const columns = editable
    ? SPANS
    : SPANS.map((s) => ({ ...s, span: s.span - 1 }));

  return (
    <section
      id="recurring-tasks"
      aria-labelledby="recurring-tasks-heading"
      className="scroll-mt-6 overflow-hidden rounded-lg border border-border-card bg-surface-card lg:scroll-mt-20"
    >
      <div className="flex flex-col gap-1 border-b border-border-divider px-5 py-3.5">
        <h2
          id="recurring-tasks-heading"
          className="text-md leading-tight font-semibold text-text-primary"
        >
          Recurring tasks
        </h2>
        <p className="text-xs leading-snug text-text-muted">
          {overdue} overdue · {doneThisYear} done this year
        </p>
      </div>

      {showScope ? (
        <div className="border-b border-border-divider py-3">
          <TaskScopeFilter scopes={scopes} scope={scope} />
        </div>
      ) : null}

      {tasks.length === 0 ? (
        <p className="px-5 py-6 text-sm text-text-tertiary">
          No recurring tasks yet
        </p>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-start gap-3 px-5 py-8 sm:items-center sm:text-center">
          <p className="text-sm font-medium text-text-primary">
            No {filteredTo} tasks
          </p>
          <TaskScopeFilterClear />
        </div>
      ) : (
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {editable ? (
                <TableHead className="w-12 pl-5">
                  <span className="sr-only">Done</span>
                </TableHead>
              ) : null}
              <TableHead className={cn(!editable && "pl-5")}>
                <span className="field-label">Task</span>
              </TableHead>
              <TableHead className="hidden w-32 md:table-cell">
                <span className="field-label">Frequency</span>
              </TableHead>
              <TableHead className="w-28 text-right max-md:pr-5">
                <span className="field-label">Next due</span>
              </TableHead>
              <TableHead className="hidden w-24 pr-5 text-right md:table-cell">
                <span className="field-label">Cost</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          {groups.map((group) => (
            <TableBody key={group.key}>
              {showScope ? (
                <TableRow className="border-border-divider bg-surface-subtle hover:bg-surface-subtle">
                  {columns.map(({ span, className }) => (
                    <th
                      key={span}
                      scope="rowgroup"
                      colSpan={span}
                      className={cn(
                        "px-5 py-2 text-left font-normal",
                        className,
                      )}
                    >
                      <ScopeLabel>{group.label}</ScopeLabel>
                    </th>
                  ))}
                </TableRow>
              ) : null}
              {group.tasks.map((task) => (
                <Row
                  key={task.id}
                  task={task}
                  today={today}
                  editable={editable}
                />
              ))}
            </TableBody>
          ))}
        </Table>
      )}

      {editable ? (
        <div className="border-t border-border-divider">
          <AddTaskForm
            mode="recurring"
            buildings={[
              {
                id: building.id,
                name: building.name,
                units: units.filter((unit) => !unit.retired),
              },
            ]}
            buildingId={building.id}
          />
        </div>
      ) : null}
    </section>
  );
}

/** Soonest first; an occurrence with no date after every dated one. */
function sorted(tasks: TaskRecord[]): TaskRecord[] {
  return [...tasks].sort(
    (a, b) =>
      (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id),
  );
}

function Row({
  task,
  today,
  editable,
}: {
  task: TaskRecord;
  today: CalendarDate;
  editable: boolean;
}) {
  const firstLine = task.notes?.split("\n")[0]?.trim() || null;
  const note = task.dueDate ? dueNote(task.dueDate, today) : null;
  const folded = [
    frequencyLabel(task.recurrenceMonths),
    task.estCostCents === null ? null : formatMoney(task.estCostCents),
  ]
    .filter(Boolean)
    .join(" · ");

  const cells = (
    <>
      <TableCell
        className={cn("align-top whitespace-normal", !editable && "pl-5")}
      >
        <span className="block text-sm font-medium text-text-primary">
          {task.title}
        </span>
        {firstLine ? (
          <span className="block truncate text-2xs leading-snug text-text-muted">
            {firstLine}
          </span>
        ) : null}
        <span className="block text-2xs leading-snug text-text-muted md:hidden">
          {folded}
        </span>
      </TableCell>
      <TableCell className="hidden align-top md:table-cell">
        <span className="text-sm text-text-primary">
          {frequencyLabel(task.recurrenceMonths)}
        </span>
      </TableCell>
      <TableCell className="text-right align-top max-md:pr-5">
        {task.dueDate ? (
          <DateValue
            date={task.dueDate}
            form={shortFormIn(task.dueDate, today)}
            className="text-sm text-text-primary"
          />
        ) : (
          <span className="text-sm text-text-muted">Not scheduled</span>
        )}
        {note ? (
          <span
            className={cn(
              "block text-2xs leading-snug",
              note.kind === "late"
                ? "text-status-danger"
                : "text-status-warning",
            )}
          >
            {dueNoteText(note)}
          </span>
        ) : null}
      </TableCell>
      <TableCell className="hidden pr-5 text-right align-top md:table-cell">
        {task.estCostCents === null ? (
          <span className="text-sm text-text-muted">—</span>
        ) : (
          <Money
            cents={task.estCostCents}
            className="text-sm text-text-primary"
          />
        )}
      </TableCell>
    </>
  );

  if (!editable) {
    return (
      <TableRow className="border-border-divider hover:bg-hover-fill-subtle">
        {cells}
      </TableRow>
    );
  }

  return (
    <CheckoffRow taskId={task.id} title={task.title} spans={SPANS}>
      {cells}
    </CheckoffRow>
  );
}
