/**
 * The task rules where a wrong answer is quiet: a next occurrence a day off or
 * a quarter early, a task due today counted overdue, a yearly job counted
 * twice in its twelve months, and a seasonal strip that invents a month.
 */
import { describe, expect, it } from "vitest";

import {
  daysLate,
  dueNote,
  dueNoteText,
  firstDueDate,
  frequencyLabel,
  heatLevel,
  inLastTwelveMonths,
  maintenanceFigures,
  nextOccurrence,
  scheduleGroup,
  seasonalCounts,
  taskHref,
  type TileTask,
} from "@/lib/tasks";

describe("taskHref", () => {
  it("opens the modal over the page's tab and filter, and closes back to them", () => {
    const query = { building: "b1", tab: "scheduled" };

    expect(taskHref("/maintenance", query, "t1")).toBe(
      "/maintenance?building=b1&tab=scheduled&task=t1",
    );
    expect(taskHref("/maintenance", { ...query, task: "t1" }, null)).toBe(
      "/maintenance?building=b1&tab=scheduled",
    );
  });

  it("replaces a task already open rather than adding a second", () => {
    expect(taskHref("/maintenance", { task: ["t1", "t2"] }, "new")).toBe(
      "/maintenance?task=new",
    );
    expect(taskHref("/maintenance", { task: "t1" }, null)).toBe("/maintenance");
  });
});

describe("nextOccurrence", () => {
  it("is one interval after the due date when the work is done on the day", () => {
    expect(
      nextOccurrence({
        dueDate: "2026-09-01",
        completedOn: "2026-09-01",
        recurrenceMonths: 3,
      }),
    ).toBe("2026-12-01");
  });

  it("keeps the schedule when the work is done late in the interval", () => {
    expect(
      nextOccurrence({
        dueDate: "2026-09-01",
        completedOn: "2026-09-20",
        recurrenceMonths: 3,
      }),
    ).toBe("2026-12-01");
  });

  it("keeps the schedule when the work is done early", () => {
    // Done a week before it was due: the next one is still a quarter after
    // the due date, not after the day it was done.
    expect(
      nextOccurrence({
        dueDate: "2026-09-01",
        completedOn: "2026-08-25",
        recurrenceMonths: 3,
      }),
    ).toBe("2026-12-01");
  });

  it("skips the intervals a late completion has already passed", () => {
    // A monthly job caught up three and a half months late leaves no overdue
    // occurrence behind it.
    expect(
      nextOccurrence({
        dueDate: "2026-05-10",
        completedOn: "2026-08-24",
        recurrenceMonths: 1,
      }),
    ).toBe("2026-09-10");
    // Exactly on a later step's day, that step is the one done.
    expect(
      nextOccurrence({
        dueDate: "2026-05-10",
        completedOn: "2026-08-10",
        recurrenceMonths: 1,
      }),
    ).toBe("2026-09-10");
  });

  it("finds its way forward from a date decades behind", () => {
    expect(
      nextOccurrence({
        dueDate: "1998-06-15",
        completedOn: "2026-09-16",
        recurrenceMonths: 24,
      }),
    ).toBe("2028-06-15");
  });

  it("counts every step from the due date, so the 31st comes back", () => {
    expect(
      nextOccurrence({
        dueDate: "2026-01-31",
        completedOn: "2026-01-31",
        recurrenceMonths: 1,
      }),
    ).toBe("2026-02-28");
    // Done in February, on the short month's last day: March is the 31st
    // again, not the 28th carried forward.
    expect(
      nextOccurrence({
        dueDate: "2026-01-31",
        completedOn: "2026-02-28",
        recurrenceMonths: 1,
      }),
    ).toBe("2026-03-31");
  });

  it("starts from the completion for a task that had no date", () => {
    expect(
      nextOccurrence({
        dueDate: null,
        completedOn: "2026-09-16",
        recurrenceMonths: 12,
      }),
    ).toBe("2027-09-16");
  });

  it("crosses a year", () => {
    expect(
      nextOccurrence({
        dueDate: "2026-11-15",
        completedOn: "2026-11-15",
        recurrenceMonths: 6,
      }),
    ).toBe("2027-05-15");
  });

  it("refuses an interval that is not a positive whole number of months", () => {
    for (const recurrenceMonths of [0, -3, 1.5]) {
      expect(() =>
        nextOccurrence({
          dueDate: "2026-09-01",
          completedOn: "2026-09-01",
          recurrenceMonths,
        }),
      ).toThrow(RangeError);
    }
  });
});

describe("firstDueDate", () => {
  it("is one interval from today", () => {
    expect(firstDueDate("2026-09-16", 3)).toBe("2026-12-16");
    expect(firstDueDate("2026-08-31", 6)).toBe("2027-02-28");
  });
});

describe("frequencyLabel", () => {
  it("names the five intervals, a one-off, and anything else plainly", () => {
    expect(
      [1, 3, 6, 12, 24, null, 18].map((months) => frequencyLabel(months)),
    ).toEqual([
      "Monthly",
      "Every 3 months",
      "Every 6 months",
      "Annually",
      "Every 2 years",
      "Once",
      "Every 18 months",
    ]);
  });
});

describe("scheduleGroup", () => {
  const today = "2026-09-16";

  it("puts yesterday in Overdue and today in the next 30 days", () => {
    expect(scheduleGroup("2026-09-15", today)).toBe("overdue");
    expect(scheduleGroup("2026-09-16", today)).toBe("next-30-days");
  });

  it("keeps the thirtieth day in, and the thirty-first out", () => {
    expect(scheduleGroup("2026-10-16", today)).toBe("next-30-days");
    expect(scheduleGroup("2026-10-17", today)).toBe("later");
  });
});

describe("dueNote", () => {
  const today = "2026-09-16";

  it("says how late, today, how soon inside 21 days, and nothing further off", () => {
    expect(dueNote("2026-09-08", today)).toEqual({ kind: "late", days: 8 });
    expect(dueNote("2026-09-16", today)).toEqual({ kind: "today" });
    expect(dueNote("2026-09-20", today)).toEqual({ kind: "soon", days: 4 });
    expect(dueNote("2026-10-06", today)).toEqual({ kind: "soon", days: 20 });
    expect(dueNote("2026-10-07", today)).toBeNull();
  });

  it("reads as the specs write it", () => {
    expect(dueNoteText({ kind: "late", days: 8 })).toBe("8 days late");
    expect(dueNoteText({ kind: "late", days: 1 })).toBe("1 day late");
    expect(dueNoteText({ kind: "soon", days: 4 })).toBe("in 4 days");
    expect(dueNoteText({ kind: "today" })).toBe("due today");
  });
});

describe("daysLate", () => {
  it("counts days past the due date, and nothing for on time or no date", () => {
    expect(daysLate({ dueDate: "2026-09-01", completedOn: "2026-09-04" })).toBe(
      3,
    );
    expect(
      daysLate({ dueDate: "2026-09-01", completedOn: "2026-09-01" }),
    ).toBeNull();
    expect(
      daysLate({ dueDate: "2026-09-01", completedOn: "2026-08-30" }),
    ).toBeNull();
    expect(daysLate({ dueDate: null, completedOn: "2026-09-01" })).toBeNull();
  });
});

describe("inLastTwelveMonths", () => {
  const today = "2026-09-16";

  it("includes today and the day after a year ago, and not a year ago itself", () => {
    expect(inLastTwelveMonths("2026-09-16", today)).toBe(true);
    expect(inLastTwelveMonths("2025-09-17", today)).toBe(true);
    expect(inLastTwelveMonths("2025-09-16", today)).toBe(false);
  });

  it("leaves out a date after today", () => {
    expect(inLastTwelveMonths("2026-09-17", today)).toBe(false);
  });
});

describe("seasonalCounts", () => {
  const today = "2026-09-16";
  // January first, as the strip draws it.
  const month = (counts: number[], name: number) => counts[name - 1];

  it("counts a monthly task once in every month", () => {
    expect(
      seasonalCounts([{ dueDate: "2026-09-30", recurrenceMonths: 1 }], today),
    ).toEqual(Array(12).fill(1));
  });

  it("counts a quarterly task in its four months", () => {
    const counts = seasonalCounts(
      [{ dueDate: "2026-10-01", recurrenceMonths: 3 }],
      today,
    );
    expect(counts).toEqual([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]);
  });

  it("counts a two-yearly task only when it lands inside the twelve months", () => {
    expect(
      month(
        seasonalCounts(
          [{ dueDate: "2027-05-01", recurrenceMonths: 24 }],
          today,
        ),
        5,
      ),
    ).toBe(1);
    expect(
      seasonalCounts([{ dueDate: "2027-10-01", recurrenceMonths: 24 }], today),
    ).toEqual(Array(12).fill(0));
  });

  it("counts this month from its first day, a task due earlier in it included", () => {
    // Due on the 2nd and not yet done: still September's.
    expect(
      month(
        seasonalCounts(
          [{ dueDate: "2026-09-02", recurrenceMonths: 12 }],
          today,
        ),
        9,
      ),
    ).toBe(1);
  });

  it("steps an overdue task forward to the year, from its own schedule", () => {
    // Annual, last due in March 2024 and never done: its schedule's next
    // March is inside the twelve months, and nothing else is.
    expect(
      seasonalCounts([{ dueDate: "2024-03-15", recurrenceMonths: 12 }], today),
    ).toEqual([0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("stops before this month comes round again", () => {
    // Twelve months from September is August next year; a monthly task
    // counts September once, not twice.
    expect(
      month(
        seasonalCounts([{ dueDate: "2026-09-01", recurrenceMonths: 1 }], today),
        9,
      ),
    ).toBe(1);
  });

  it("adds tasks together, and skips one with no date or no interval", () => {
    const counts = seasonalCounts(
      [
        { dueDate: "2026-10-01", recurrenceMonths: 12 },
        { dueDate: "2026-10-20", recurrenceMonths: 6 },
        { dueDate: null, recurrenceMonths: 3 },
        { dueDate: "2026-10-05", recurrenceMonths: null },
      ],
      today,
    );
    expect(month(counts, 10)).toBe(2);
    expect(month(counts, 4)).toBe(1);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe("heatLevel", () => {
  it("steps at one, three and four", () => {
    expect([0, 1, 2, 3, 4, 9].map(heatLevel)).toEqual([0, 1, 1, 2, 3, 3]);
  });
});

describe("maintenanceFigures", () => {
  const today = "2026-09-16";

  function task(overrides: Partial<TileTask>): TileTask {
    return {
      status: "scheduled",
      dueDate: "2026-09-20",
      completedOn: null,
      estCostCents: null,
      actualCostCents: null,
      today,
      ...overrides,
    };
  }

  it("counts overdue tasks and names the oldest date", () => {
    const figures = maintenanceFigures([
      task({ dueDate: "2026-09-08" }),
      task({ dueDate: "2026-08-24" }),
      task({ dueDate: "2026-09-16" }),
    ]);
    expect(figures.overdue).toEqual({ count: 2, oldest: "2026-08-24" });
  });

  it("counts the next 30 days, today included, with their estimates", () => {
    const figures = maintenanceFigures([
      task({ dueDate: "2026-09-16", estCostCents: 18_000 }),
      task({ dueDate: "2026-10-16", estCostCents: 42_500 }),
      task({ dueDate: "2026-10-17", estCostCents: 99_900 }),
      task({ dueDate: "2026-09-20", estCostCents: null }),
    ]);
    expect(figures.nextThirtyDays).toEqual({
      count: 3,
      estimatedCents: 60_500,
    });
  });

  it("sums what was spent in the last twelve months, counting tasks with no cost", () => {
    const figures = maintenanceFigures([
      task({
        status: "done",
        completedOn: "2026-02-10",
        actualCostCents: 32_000,
      }),
      task({
        status: "done",
        completedOn: "2025-12-01",
        actualCostCents: null,
      }),
      task({
        status: "done",
        completedOn: "2025-09-16",
        actualCostCents: 50_000,
      }),
    ]);
    expect(figures.spentLastTwelveMonths).toEqual({ cents: 32_000, tasks: 2 });
  });

  it("counts this year's completions, and which were on time", () => {
    const figures = maintenanceFigures([
      task({
        status: "done",
        dueDate: "2026-03-01",
        completedOn: "2026-03-01",
      }),
      task({
        status: "done",
        dueDate: "2026-03-01",
        completedOn: "2026-03-09",
      }),
      task({ status: "done", dueDate: null, completedOn: "2026-01-02" }),
      task({
        status: "done",
        dueDate: "2025-12-20",
        completedOn: "2025-12-31",
      }),
    ]);
    expect(figures.doneThisYear).toEqual({ count: 3, onTime: 2 });
  });

  it("evaluates each task against its own building's day", () => {
    // The same instant: already the 17th at one building, still the 16th at
    // the other. A task due on the 16th is overdue only at the first.
    const figures = maintenanceFigures([
      task({ dueDate: "2026-09-16", today: "2026-09-17" }),
      task({ dueDate: "2026-09-16", today: "2026-09-16" }),
    ]);
    expect(figures.overdue.count).toBe(1);
    expect(figures.nextThirtyDays.count).toBe(1);
  });

  it("counts cancelled and unscheduled tasks nowhere", () => {
    const figures = maintenanceFigures([
      task({ status: "canceled", dueDate: "2026-09-01" }),
      task({ status: "unscheduled", dueDate: null, estCostCents: 5_000 }),
    ]);
    expect(figures).toEqual({
      overdue: { count: 0, oldest: null },
      nextThirtyDays: { count: 0, estimatedCents: 0 },
      spentLastTwelveMonths: { cents: 0, tasks: 0 },
      doneThisYear: { count: 0, onTime: 0 },
    });
  });
});
