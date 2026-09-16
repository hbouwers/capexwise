/**
 * The rules a task is shown and completed by (PRD F5,
 * `docs/ui/screens/maintenance.md` and the building page's Recurring tasks
 * and Seasonal rhythm): when a recurring task is next due, how late one is,
 * which group of the Scheduled tab it sits in, how many fall due in each
 * month, and Maintenance's four tiles.
 *
 * Dates, not instants. Every rule takes "today" as an argument, and it is
 * today where the task's building is (ADR-0005) — a portfolio-level figure
 * evaluates each task against its own building's day, so a caller passes a
 * `today` per task rather than one for the page.
 */
import {
  addDays,
  addMonths,
  addMonthsKeepingDay,
  type CalendarDate,
  daysBetween,
  firstOfMonth,
  monthOf,
  yearOf,
} from "@/lib/dates";
import type { Cents } from "@/lib/money";

/**
 * The intervals a recurring task can have, in months, in the order the
 * frequency `Select` offers them (`building-detail.md`). "As needed" is not
 * one: a task with no interval is a one-off.
 */
export const FREQUENCIES = [1, 3, 6, 12, 24] as const;

export type Frequency = (typeof FREQUENCIES)[number];

const FREQUENCY_LABELS: Record<Frequency, string> = {
  1: "Monthly",
  3: "Every 3 months",
  6: "Every 6 months",
  12: "Annually",
  24: "Every 2 years",
};

export function isFrequency(months: number): months is Frequency {
  return (FREQUENCIES as readonly number[]).includes(months);
}

/**
 * `Every 3 months`, `Annually` — or `Once` for a one-off, Maintenance's
 * Repeats column. An interval the list does not offer, which only a direct
 * write could store, still reads as what it is.
 */
export function frequencyLabel(recurrenceMonths: number | null): string {
  if (recurrenceMonths === null) return "Once";
  if (isFrequency(recurrenceMonths)) return FREQUENCY_LABELS[recurrenceMonths];
  return `Every ${recurrenceMonths} months`;
}

export const PRIORITY_LABELS = {
  high: "High",
  normal: "Normal",
  low: "Low",
} as const;

export type Priority = keyof typeof PRIORITY_LABELS;

/**
 * **The next occurrence keeps the schedule, not the day the work got done**
 * (`docs/data-model.md` §6): the first date after the completion that lies a
 * whole number of intervals past the task's due date — past the completion
 * itself for a task that had no date.
 *
 * - Done early, the next one is still one interval after the day it was due,
 *   not the day it was done: gutters due September 1, cleaned August 25, are
 *   next due December 1.
 * - Done late, whole intervals are skipped until one is still ahead, so a
 *   monthly job caught up after a quarter leaves no overdue occurrence behind.
 * - Every step is counted from the due date rather than from the step before,
 *   so a task due on the 31st comes back on a shorter month's last day and on
 *   the 31st again after it.
 */
export function nextOccurrence(task: {
  dueDate: CalendarDate | null;
  completedOn: CalendarDate;
  recurrenceMonths: number;
}): CalendarDate {
  const { dueDate, completedOn, recurrenceMonths } = task;
  if (!Number.isSafeInteger(recurrenceMonths) || recurrenceMonths <= 0) {
    throw new RangeError(
      `Expected a positive whole number of months, got ${recurrenceMonths}.`,
    );
  }

  const anchor = dueDate ?? completedOn;

  // A first guess at how many intervals lie between the anchor and the
  // completion, whole months apart, then stepped until it is past both: at
  // most a step or two either way, however late the work was.
  const months =
    (yearOf(completedOn) - yearOf(anchor)) * 12 +
    (monthOf(completedOn) - monthOf(anchor));
  let steps = Math.max(1, Math.floor(months / recurrenceMonths));

  while (
    steps > 1 &&
    addMonthsKeepingDay(anchor, (steps - 1) * recurrenceMonths) > completedOn
  ) {
    steps -= 1;
  }
  while (addMonthsKeepingDay(anchor, steps * recurrenceMonths) <= completedOn) {
    steps += 1;
  }

  return addMonthsKeepingDay(anchor, steps * recurrenceMonths);
}

/**
 * A new recurring task's first due date: one interval from today
 * (`building-detail.md`, the inline add row). The task modal changes it.
 */
export function firstDueDate(
  today: CalendarDate,
  recurrenceMonths: number,
): CalendarDate {
  return addMonthsKeepingDay(today, recurrenceMonths);
}

/** How far ahead Maintenance's `Next 30 days` looks, today included. */
export const NEXT_DAYS = 30;

/**
 * Where a scheduled task sits on the Scheduled tab: **Overdue** before today,
 * **Next 30 days** from today to thirty days on, and **Later** after that. A
 * task due today is not overdue — it is due.
 */
export type ScheduleGroup = "overdue" | "next-30-days" | "later";

export function scheduleGroup(
  dueDate: CalendarDate,
  today: CalendarDate,
): ScheduleGroup {
  if (dueDate < today) return "overdue";
  if (dueDate <= addDays(today, NEXT_DAYS)) return "next-30-days";
  return "later";
}

/**
 * What sits beside a due date (`screens/README.md`, Dates): `8 days late` in
 * the danger colour, `in 4 days` in the warning colour inside `soonDays`, and
 * `due today` for today. Null for a date further off, which is only a date.
 */
export type DueNote =
  | { kind: "late"; days: number }
  | { kind: "today" }
  | { kind: "soon"; days: number };

/** The building page's Recurring tasks mark a date "soon" inside 21 days. */
export const SOON_DAYS = 21;

export function dueNote(
  dueDate: CalendarDate,
  today: CalendarDate,
  soonDays = SOON_DAYS,
): DueNote | null {
  const days = daysBetween(today, dueDate);

  if (days < 0) return { kind: "late", days: -days };
  if (days === 0) return { kind: "today" };
  if (days < soonDays) return { kind: "soon", days };
  return null;
}

export function dueNoteText(note: DueNote): string {
  if (note.kind === "today") return "due today";
  const days = note.days === 1 ? "1 day" : `${note.days} days`;
  return note.kind === "late" ? `${days} late` : `in ${days}`;
}

/**
 * How late a task was done: the days from its due date to its completion, or
 * null when it was on time or had no date to be late against — the Done tab's
 * `{n} days late`, and the negative of `Done this year`'s `on time`.
 */
export function daysLate(task: {
  dueDate: CalendarDate | null;
  completedOn: CalendarDate;
}): number | null {
  if (task.dueDate === null) return null;
  const days = daysBetween(task.dueDate, task.completedOn);
  return days > 0 ? days : null;
}

/**
 * Whether a completion falls in the twelve months up to today — the Done
 * tab's default window and the `Spent, last 12 months` tile's. The day a year
 * ago is outside it, so a yearly job done on the same date twice counts once.
 */
export function inLastTwelveMonths(
  completedOn: CalendarDate,
  today: CalendarDate,
): boolean {
  return completedOn > addMonthsKeepingDay(today, -12) && completedOn <= today;
}

/**
 * The Seasonal rhythm strip (`building-detail.md`): how many of a building's
 * recurring tasks fall due in each month of a year, January first.
 *
 * **Read from the rule, not from generated rows** (§6): each task's next due
 * date stepped by its interval, over the twelve months starting with this
 * one. A monthly task counts once in every month, a yearly one once, and one
 * every two years in the month it lands in if that is inside the year — and
 * nowhere if not, since it is not due this year. An overdue task counts from
 * the first step that is not behind the year. A task with no due date is not
 * on a schedule yet, and counts nowhere.
 */
export function seasonalCounts(
  tasks: readonly {
    dueDate: CalendarDate | null;
    recurrenceMonths: number | null;
  }[],
  today: CalendarDate,
): number[] {
  const counts = Array.from({ length: 12 }, () => 0);
  const start = firstOfMonth(today);
  const end = addMonths(start, 12);

  for (const { dueDate, recurrenceMonths } of tasks) {
    if (dueDate === null || recurrenceMonths === null || recurrenceMonths <= 0)
      continue;

    // The first step not behind the window, found by whole months rather than
    // by walking a decade-old due date forward one interval at a time.
    const behind =
      (yearOf(start) - yearOf(dueDate)) * 12 +
      (monthOf(start) - monthOf(dueDate));
    let step = Math.max(0, Math.floor(behind / recurrenceMonths) - 1);
    while (addMonthsKeepingDay(dueDate, step * recurrenceMonths) < start)
      step += 1;

    for (
      let date = addMonthsKeepingDay(dueDate, step * recurrenceMonths);
      date < end;
      step += 1, date = addMonthsKeepingDay(dueDate, step * recurrenceMonths)
    ) {
      counts[monthOf(date) - 1]! += 1;
    }
  }

  return counts;
}

/**
 * `SeasonalStrip`'s heat (`components.md` §7): nothing, one or two, three,
 * four or more.
 */
export function heatLevel(count: number): 0 | 1 | 2 | 3 {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count === 3) return 2;
  return 3;
}

/** What Maintenance's tiles read of a task, and the day at its building. */
export type TileTask = {
  status: "unscheduled" | "scheduled" | "done" | "canceled";
  dueDate: CalendarDate | null;
  completedOn: CalendarDate | null;
  estCostCents: Cents | null;
  actualCostCents: Cents | null;
  /** Today where the task's building is. */
  today: CalendarDate;
};

export type MaintenanceFigures = {
  overdue: { count: number; oldest: CalendarDate | null };
  nextThirtyDays: { count: number; estimatedCents: Cents };
  spentLastTwelveMonths: { cents: Cents; tasks: number };
  doneThisYear: { count: number; onTime: number };
};

/**
 * Maintenance's four tiles (`maintenance.md`), each the count or sum of a list
 * on the same page, so every figure traces to rows somebody can read:
 *
 * - **Overdue**: scheduled tasks before today, and the oldest of their dates.
 * - **Next 30 days**: scheduled tasks from today to thirty days on, and what
 *   they are estimated to cost.
 * - **Spent, last 12 months**: the actual cost of tasks done in the Done tab's
 *   window — a task done with no cost recorded counts toward the tasks and
 *   adds nothing. Until expense entry (v1), the task's own `actual_cost_cents`
 *   is the one source.
 * - **Done this year**: tasks done since January 1, and how many of them on
 *   or before their due date. One with no due date could not be late.
 *
 * Cancelled tasks count nowhere.
 */
export function maintenanceFigures(
  tasks: readonly TileTask[],
): MaintenanceFigures {
  const figures: MaintenanceFigures = {
    overdue: { count: 0, oldest: null },
    nextThirtyDays: { count: 0, estimatedCents: 0 },
    spentLastTwelveMonths: { cents: 0, tasks: 0 },
    doneThisYear: { count: 0, onTime: 0 },
  };

  for (const task of tasks) {
    if (task.status === "scheduled" && task.dueDate !== null) {
      const group = scheduleGroup(task.dueDate, task.today);

      if (group === "overdue") {
        figures.overdue.count += 1;
        if (
          figures.overdue.oldest === null ||
          task.dueDate < figures.overdue.oldest
        ) {
          figures.overdue.oldest = task.dueDate;
        }
      } else if (group === "next-30-days") {
        figures.nextThirtyDays.count += 1;
        figures.nextThirtyDays.estimatedCents += task.estCostCents ?? 0;
      }
    }

    if (task.status === "done" && task.completedOn !== null) {
      if (inLastTwelveMonths(task.completedOn, task.today)) {
        figures.spentLastTwelveMonths.tasks += 1;
        figures.spentLastTwelveMonths.cents += task.actualCostCents ?? 0;
      }

      if (
        yearOf(task.completedOn) === yearOf(task.today) &&
        task.completedOn <= task.today
      ) {
        figures.doneThisYear.count += 1;
        if (
          daysLate({ dueDate: task.dueDate, completedOn: task.completedOn }) ===
          null
        ) {
          figures.doneThisYear.onTime += 1;
        }
      }
    }
  }

  return figures;
}
