/**
 * The portfolio's task figures (`docs/ui/screens/portfolio.md`, PRD F0): the
 * Open tasks and Upcoming tasks tiles, the `Due in the next 30 days` list, and
 * each building card's `Tasks due`. One window for all of them — overdue, or
 * due from today to thirty days on, by `scheduleGroup` — so the list is the
 * tile's contents and the card's count is the list's share of one building,
 * rather than three definitions of "soon".
 *
 * Every task is judged against today where its own building is (ADR-0005),
 * so a caller passes a `today` per task, as Maintenance's tiles do.
 */
import type { CalendarDate } from "@/lib/dates";
import { type Priority, scheduleGroup } from "@/lib/tasks";

/** How many rows `Due in the next 30 days` lists before `All` takes over. */
export const DUE_LIST_LIMIT = 6;

/** What these rules read of a task, and the day at its building. */
export type PortfolioTask = {
  id: string;
  title: string;
  status: "unscheduled" | "scheduled" | "done" | "canceled";
  priority: Priority;
  dueDate: CalendarDate | null;
  /** Today where the task's building is. */
  today: CalendarDate;
};

export type TaskTiles = {
  /** Unscheduled tasks, and how many of them are high priority. */
  open: { count: number; highPriority: number };
  /**
   * Scheduled tasks due from today to thirty days on, and — apart, as the
   * tile's split value — the scheduled tasks already overdue.
   */
  upcoming: { count: number; overdue: number };
};

/** The two task tiles. Done and cancelled tasks count in neither. */
export function taskTiles(tasks: readonly PortfolioTask[]): TaskTiles {
  const tiles: TaskTiles = {
    open: { count: 0, highPriority: 0 },
    upcoming: { count: 0, overdue: 0 },
  };

  for (const task of tasks) {
    if (task.status === "unscheduled") {
      tiles.open.count += 1;
      if (task.priority === "high") tiles.open.highPriority += 1;
    }

    if (task.status === "scheduled" && task.dueDate !== null) {
      const group = scheduleGroup(task.dueDate, task.today);
      if (group === "overdue") tiles.upcoming.overdue += 1;
      else if (group === "next-30-days") tiles.upcoming.count += 1;
    }
  }

  return tiles;
}

/**
 * The scheduled tasks that are overdue or due in the next thirty days,
 * **overdue first, then by date**, then by title and id so two tasks on one
 * day keep their order between renders. Every one of them, uncut: the page
 * lists the first `DUE_LIST_LIMIT`, and a card counts its building's.
 *
 * Overdue is its own key rather than left to the date, because with buildings
 * in different zones a task a day late in one can carry the same date as a
 * task due today in another.
 */
export function dueInNextThirtyDays<T extends PortfolioTask>(
  tasks: readonly T[],
): T[] {
  return tasks
    .filter(
      (task) =>
        task.status === "scheduled" &&
        task.dueDate !== null &&
        scheduleGroup(task.dueDate, task.today) !== "later",
    )
    .map((task) => ({
      task,
      overdue: scheduleGroup(task.dueDate!, task.today) === "overdue",
    }))
    .sort(
      (a, b) =>
        Number(b.overdue) - Number(a.overdue) ||
        compare(a.task.dueDate!, b.task.dueDate!) ||
        compare(a.task.title, b.task.title) ||
        compare(a.task.id, b.task.id),
    )
    .map(({ task }) => task);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
