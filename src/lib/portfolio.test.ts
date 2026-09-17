/**
 * The portfolio's one window for "soon": the two task tiles and the list they
 * share. The regressions worth holding are the window's edges, each task read
 * against its own building's day, and the list's order across zones.
 */
import { describe, expect, it } from "vitest";

import {
  dueInNextThirtyDays,
  type PortfolioTask,
  taskTiles,
} from "@/lib/portfolio";

const TODAY = "2026-09-16";

let nextId = 0;

function task(overrides: Partial<PortfolioTask> = {}): PortfolioTask {
  nextId += 1;
  return {
    id: `task-${String(nextId).padStart(3, "0")}`,
    title: `Task ${nextId}`,
    status: "scheduled",
    priority: "normal",
    dueDate: TODAY,
    today: TODAY,
    ...overrides,
  };
}

describe("taskTiles", () => {
  it("counts unscheduled tasks, and the high-priority ones among them", () => {
    expect(
      taskTiles([
        task({ status: "unscheduled", dueDate: null, priority: "high" }),
        task({ status: "unscheduled", dueDate: null }),
        task({ status: "done", priority: "high" }),
      ]).open,
    ).toEqual({ count: 2, highPriority: 1 });
  });

  it("counts today through thirty days on as upcoming, and earlier as overdue", () => {
    expect(
      taskTiles([
        task({ dueDate: "2026-09-15" }),
        task({ dueDate: TODAY }),
        task({ dueDate: "2026-10-16" }),
        task({ dueDate: "2026-10-17" }),
        task({ status: "done", dueDate: "2026-09-01" }),
        task({ status: "canceled", dueDate: "2026-09-20" }),
      ]).upcoming,
    ).toEqual({ count: 2, overdue: 1 });
  });

  it("reads each task against its own building's day", () => {
    // Late on the 16th in one zone, already the 17th in another.
    expect(
      taskTiles([
        task({ dueDate: TODAY, today: TODAY }),
        task({ dueDate: TODAY, today: "2026-09-17" }),
      ]).upcoming,
    ).toEqual({ count: 1, overdue: 1 });
  });
});

describe("dueInNextThirtyDays", () => {
  it("lists overdue first, then by date, and leaves out later and unscheduled work", () => {
    const later = task({ dueDate: "2026-11-01" });
    const soon = task({ dueDate: "2026-09-20" });
    const late = task({ dueDate: "2026-09-01" });
    const today = task({ dueDate: TODAY });
    const unscheduled = task({ status: "unscheduled", dueDate: null });

    expect(
      dueInNextThirtyDays([later, soon, late, today, unscheduled]),
    ).toEqual([late, today, soon]);
  });

  it("puts an overdue task before one due the same day in a later zone", () => {
    const dueToday = task({ dueDate: TODAY, today: TODAY, title: "A" });
    const dayLate = task({ dueDate: TODAY, today: "2026-09-17", title: "B" });

    expect(dueInNextThirtyDays([dueToday, dayLate])).toEqual([
      dayLate,
      dueToday,
    ]);
  });
});
