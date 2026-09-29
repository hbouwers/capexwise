/**
 * The demo's expenses, derived from its tasks and utilities. What a mistake
 * here costs is the nightly reset: a category that is not a seeded slug, or
 * a date after today, and the reset fails in production and leaves last
 * night's demo up — the one failure a visitor would not see and nobody would
 * notice.
 */
import { describe, expect, it } from "vitest";

import { demoExpenses, demoPortfolio } from "@/lib/demo-portfolio";

/** `drizzle/0027_seed_schedule_e_categories.sql`, spelled out. */
const SEEDED = new Set([
  "advertising",
  "auto-and-travel",
  "cleaning",
  "commissions",
  "insurance",
  "professional-fees",
  "management-fees",
  "mortgage-interest",
  "other-interest",
  "repairs",
  "supplies",
  "taxes",
  "utilities",
  "other",
]);

describe("demoExpenses", () => {
  // Every day of a year, so a month boundary, a year boundary and the 15th
  // are each crossed.
  const days = Array.from({ length: 366 }, (_, i) => {
    const day = new Date(Date.UTC(2026, 0, 1 + i));
    return day.toISOString().slice(0, 10);
  });

  it("files every expense under a seeded category, never after today", () => {
    for (const today of days) {
      const { buildings } = demoPortfolio(today);

      buildings.forEach((building, index) => {
        for (const expense of demoExpenses(today, building, index === 0)) {
          expect(SEEDED.has(expense.category), expense.category).toBe(true);
          expect(expense.occurredOn <= today, expense.occurredOn).toBe(true);
          expect(expense.amountCents).not.toBe(0);
        }
      });
    }
  });

  it("bills every finished job, linked to it, and refunds once", () => {
    const today = "2026-09-17";
    const { buildings } = demoPortfolio(today);
    const all = buildings.flatMap((building, index) =>
      demoExpenses(today, building, index === 0).map((expense) => ({
        building,
        expense,
      })),
    );

    for (const building of buildings) {
      building.tasks.forEach((task, index) => {
        if (task.status !== "done" || !task.actualCostCents) return;

        expect(
          all.some(
            (row) =>
              row.building === building &&
              row.expense.task === index &&
              row.expense.amountCents === -task.actualCostCents!,
          ),
        ).toBe(true);
      });
    }

    expect(all.filter((row) => row.expense.amountCents > 0)).toHaveLength(1);
  });
});
