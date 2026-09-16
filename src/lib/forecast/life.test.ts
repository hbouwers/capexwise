/**
 * An item's age against its life. The thresholds are where this can be wrong
 * without anyone noticing — an item at exactly 85% is due soon, and one in
 * its replacement year is past life — so each boundary is tested from both
 * sides.
 */
import { describe, expect, it } from "vitest";

import {
  ageInYears,
  lifeStatus,
  lifeUsedPercent,
  replacementYear,
} from "@/lib/forecast/life";

const THIS_YEAR = 2026;

/** An item with a 20-year life, installed `age` years ago. */
function aged(age: number, expectedLifeYears = 20) {
  return { installYear: THIS_YEAR - age, expectedLifeYears };
}

describe("replacementYear", () => {
  it("is the install year plus the expected life", () => {
    expect(replacementYear({ installYear: 2011, expectedLifeYears: 15 })).toBe(
      2026,
    );
  });

  it("keeps a past-due item's real year rather than folding it into this one", () => {
    expect(replacementYear({ installYear: 1998, expectedLifeYears: 20 })).toBe(
      2018,
    );
  });
});

describe("ageInYears", () => {
  it("counts whole years since the install year", () => {
    expect(ageInYears(aged(11), THIS_YEAR)).toBe(11);
    expect(ageInYears(aged(0), THIS_YEAR)).toBe(0);
  });

  it("does not age an item whose install year is still to come", () => {
    expect(ageInYears({ installYear: 2028, expectedLifeYears: 15 }, 2026)).toBe(
      0,
    );
  });
});

describe("lifeStatus", () => {
  it("is healthy below 60% of its life", () => {
    expect(lifeStatus(aged(0), THIS_YEAR)).toBe("healthy");
    expect(lifeStatus(aged(11), THIS_YEAR)).toBe("healthy"); // 55%
  });

  it("is watch from exactly 60%", () => {
    expect(lifeStatus(aged(12), THIS_YEAR)).toBe("watch"); // 60%
    expect(lifeStatus(aged(16), THIS_YEAR)).toBe("watch"); // 80%
  });

  it("is due soon from exactly 85%", () => {
    expect(lifeStatus(aged(17), THIS_YEAR)).toBe("due-soon"); // 85%
    expect(lifeStatus(aged(19), THIS_YEAR)).toBe("due-soon"); // 95%
  });

  it("is past life in the replacement year itself", () => {
    const item = aged(20);

    expect(replacementYear(item)).toBe(THIS_YEAR);
    expect(lifeStatus(item, THIS_YEAR)).toBe("past-life");
    expect(lifeStatus(aged(34), THIS_YEAR)).toBe("past-life");
  });

  it("holds the boundaries exactly on lives where the fraction does not", () => {
    // 0.85 × 60 = 51 and 0.6 × 15 = 9, where a floating-point comparison of
    // 51 / 60 against 0.85 is the kind that goes the wrong way.
    expect(lifeStatus(aged(51, 60), THIS_YEAR)).toBe("due-soon");
    expect(lifeStatus(aged(50, 60), THIS_YEAR)).toBe("watch");
    expect(lifeStatus(aged(9, 15), THIS_YEAR)).toBe("watch");
    expect(lifeStatus(aged(8, 15), THIS_YEAR)).toBe("healthy");
  });

  it("treats an item not yet installed as new", () => {
    expect(
      lifeStatus({ installYear: 2030, expectedLifeYears: 1 }, THIS_YEAR),
    ).toBe("healthy");
  });
});

describe("lifeUsedPercent", () => {
  it("is the share of the life used, to the nearest percent", () => {
    expect(lifeUsedPercent(aged(11, 15), THIS_YEAR)).toBe(73);
    expect(lifeUsedPercent(aged(0), THIS_YEAR)).toBe(0);
  });

  it("stops at 100 for an item past its life", () => {
    expect(lifeUsedPercent(aged(20), THIS_YEAR)).toBe(100);
    expect(lifeUsedPercent(aged(41, 15), THIS_YEAR)).toBe(100);
  });
});
