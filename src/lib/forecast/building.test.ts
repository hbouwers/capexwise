/**
 * The building card's flag and its systems-life figure. The flag is an order
 * of rules, so each is tested with the one above it absent and with it
 * present; the figure is a weighted mean, so the weighting and the cap are
 * each tested where leaving them out would give a different number.
 */
import { describe, expect, it } from "vitest";

import {
  buildingFlag,
  capexThroughNextYear,
  endOfLife,
  systemsLifeUsedPercent,
} from "@/lib/forecast/building";
import { BIG_TICKET_CENTS, type ForecastItem } from "@/lib/forecast/outflow";

const THIS_YEAR = 2026;

let nextId = 0;

/** A $1,000 item with a 20-year life, `age` years old. */
function item(
  age: number,
  overrides: Partial<ForecastItem> = {},
): ForecastItem {
  nextId += 1;
  return {
    id: `item-${String(nextId).padStart(3, "0")}`,
    label: `Item ${nextId}`,
    installYear: THIS_YEAR - age,
    expectedLifeYears: 20,
    replacementCostCents: 100_000,
    confidence: "estimated",
    status: "active",
    plannedYear: null,
    ...overrides,
  };
}

describe("buildingFlag", () => {
  it("counts the items past life first", () => {
    expect(
      buildingFlag([item(20), item(45), item(18), item(1)], THIS_YEAR),
    ).toEqual({ kind: "past-life", count: 2 });
  });

  it("counts the items due soon when none is past life", () => {
    expect(buildingFlag([item(17), item(19), item(1)], THIS_YEAR)).toEqual({
      kind: "due-soon",
      count: 2,
    });
  });

  it("names a big-ticket replacement in the next three years after that", () => {
    const roof = item(7, {
      label: "Roof",
      expectedLifeYears: 10,
      replacementCostCents: 1_050_000,
    }); // 70%, due 2029

    expect(buildingFlag([roof, item(1)], THIS_YEAR)).toEqual({
      kind: "big-ticket",
      item: roof,
      year: 2029,
    });
  });

  // #96. A plan says when the money goes out, not how old the thing is.
  it("still counts an item past life when it is planned for later", () => {
    expect(buildingFlag([item(25, { plannedYear: 2030 })], THIS_YEAR)).toEqual({
      kind: "past-life",
      count: 1,
    });
  });

  it("names a big-ticket replacement in its planned year", () => {
    const roof = item(7, {
      label: "Roof",
      expectedLifeYears: 10,
      replacementCostCents: 1_050_000,
      plannedYear: 2028,
    }); // projected 2029

    expect(buildingFlag([roof], THIS_YEAR)).toMatchObject({
      kind: "big-ticket",
      year: 2028,
    });
    // Planned out past the three years, it is no longer the flag's.
    expect(buildingFlag([{ ...roof, plannedYear: 2031 }], THIS_YEAR)).toEqual({
      kind: "healthy",
    });
  });

  it("prefers a due-soon item to a big-ticket year", () => {
    const roof = item(7, {
      expectedLifeYears: 10,
      replacementCostCents: 1_050_000,
    });

    expect(buildingFlag([roof, item(17)], THIS_YEAR).kind).toBe("due-soon");
  });

  it("names the earliest big-ticket year, then the costliest item in it", () => {
    const furnace = item(8, {
      label: "Furnace",
      expectedLifeYears: 10,
      replacementCostCents: 600_000,
    }); // 2028
    const paint = item(4, {
      label: "Paint",
      expectedLifeYears: 6,
      replacementCostCents: 900_000,
    }); // 2028, 66%
    const siding = item(7, {
      expectedLifeYears: 10,
      replacementCostCents: 2_000_000,
    }); // 2029

    expect(buildingFlag([siding, furnace, paint], THIS_YEAR)).toMatchObject({
      kind: "big-ticket",
      item: paint,
      year: 2028,
    });
  });

  it("does not look past three years, or below the big-ticket line", () => {
    const fourOut = item(6, {
      expectedLifeYears: 10,
      replacementCostCents: 2_000_000,
    }); // 2030
    const justUnder = item(7, {
      expectedLifeYears: 10,
      replacementCostCents: BIG_TICKET_CENTS - 1,
    }); // 2029

    expect(buildingFlag([fourOut, justUnder], THIS_YEAR)).toEqual({
      kind: "healthy",
    });
  });

  it("ignores replaced and removed items", () => {
    expect(
      buildingFlag(
        [item(30, { status: "replaced" }), item(19, { status: "removed" })],
        THIS_YEAR,
      ),
    ).toEqual({ kind: "healthy" });
  });
});

describe("systemsLifeUsedPercent", () => {
  it("weights each item by its replacement cost", () => {
    // $9,000 at 90% and $1,000 at 0%: 81%, where an unweighted mean is 45%.
    expect(
      systemsLifeUsedPercent(
        [item(18, { replacementCostCents: 900_000 }), item(0)],
        THIS_YEAR,
      ),
    ).toBe(81);
  });

  it("caps an item past its life at 100%", () => {
    // Uncapped, 60 years on a 20-year life would make this 200%.
    expect(systemsLifeUsedPercent([item(60), item(20)], THIS_YEAR)).toBe(100);
    expect(systemsLifeUsedPercent([item(60), item(0)], THIS_YEAR)).toBe(50);
  });

  it("rounds half up, exactly, across lives with no common fraction", () => {
    // 1/3 and 2/3 of equal weight: exactly 50%.
    expect(
      systemsLifeUsedPercent(
        [item(1, { expectedLifeYears: 3 }), item(2, { expectedLifeYears: 3 })],
        THIS_YEAR,
      ),
    ).toBe(50);
    // 50/100 and 51/100: 50.5%, up to 51.
    expect(
      systemsLifeUsedPercent(
        [
          item(50, { expectedLifeYears: 100 }),
          item(51, { expectedLifeYears: 100 }),
        ],
        THIS_YEAR,
      ),
    ).toBe(51);
    // 1/7 of the weight at 100% and the rest at 0%: 14.28…%, down to 14.
    expect(
      systemsLifeUsedPercent(
        [
          item(7, { expectedLifeYears: 7, replacementCostCents: 100_000 }),
          item(0, { replacementCostCents: 600_000 }),
        ],
        THIS_YEAR,
      ),
    ).toBe(14);
  });

  it("counts each item the same when none has a cost", () => {
    expect(
      systemsLifeUsedPercent(
        [
          item(10, { replacementCostCents: 0 }),
          item(20, { replacementCostCents: 0 }),
        ],
        THIS_YEAR,
      ),
    ).toBe(75);
  });

  it("is null with no active item", () => {
    expect(systemsLifeUsedPercent([], THIS_YEAR)).toBeNull();
    expect(
      systemsLifeUsedPercent([item(10, { status: "replaced" })], THIS_YEAR),
    ).toBeNull();
  });
});

describe("capexThroughNextYear", () => {
  it("sums next year and every year before it, and nothing after", () => {
    // Due in 2021, 2026, 2027 and 2028 on a 20-year life.
    const items = [
      item(25, { replacementCostCents: 100_000 }),
      item(20, { replacementCostCents: 200_000 }),
      item(19, { replacementCostCents: 400_000 }),
      item(18, { replacementCostCents: 800_000 }),
    ];

    expect(capexThroughNextYear(items, THIS_YEAR)).toEqual({
      cents: 700_000,
      items: 3,
      pastLife: 2,
    });
  });

  it("takes a plan's year over the projection's (#96)", () => {
    const items = [
      // Past life, and planned three years out: not through next year.
      item(25, { replacementCostCents: 100_000, plannedYear: 2029 }),
      // Healthy, and planned for next year: through next year.
      item(5, { replacementCostCents: 200_000, plannedYear: 2027 }),
    ];

    expect(capexThroughNextYear(items, THIS_YEAR)).toEqual({
      cents: 200_000,
      items: 1,
      pastLife: 0,
    });
  });

  it("leaves out replaced and removed items", () => {
    expect(
      capexThroughNextYear(
        [item(25, { status: "replaced" }), item(25, { status: "removed" })],
        THIS_YEAR,
      ),
    ).toEqual({ cents: 0, items: 0, pastLife: 0 });
  });
});

describe("endOfLife", () => {
  it("counts active items in their replacement year or past it, by confidence", () => {
    expect(
      endOfLife(
        [
          item(20, { confidence: "audited" }),
          item(31, { confidence: "estimated" }),
          item(22, { confidence: "estimated" }),
          // One year short of its life: due soon, not end of life.
          item(19, { confidence: "audited" }),
          item(40, { confidence: "audited", status: "removed" }),
        ],
        THIS_YEAR,
      ),
    ).toEqual({ audited: 1, estimated: 2 });
  });
});
