/**
 * The cases here are the ones a `Date` gets wrong: the evening in Indianapolis
 * that is already tomorrow in UTC, the night the clocks change, and a day that
 * has the right shape but is not on the calendar.
 */
import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  addMonthsKeepingDay,
  daysBetween,
  firstOfMonth,
  formatDate,
  isCalendarDate,
  isTimeZone,
  todayIn,
  yearOf,
} from "@/lib/dates";

const INDY = "America/Indiana/Indianapolis";

describe("todayIn", () => {
  it("is today at the building, not in UTC", () => {
    // 23:30 on the 14th in Indianapolis is already the 15th in UTC.
    const evening = new Date("2026-09-15T03:30:00Z");
    expect(todayIn(INDY, evening)).toBe("2026-09-14");
    expect(todayIn("UTC", evening)).toBe("2026-09-15");
  });

  it("gives two buildings their own day at the same instant", () => {
    const instant = new Date("2026-09-14T12:00:00Z");
    expect(todayIn("Pacific/Honolulu", instant)).toBe("2026-09-14");
    expect(todayIn("Pacific/Kiritimati", instant)).toBe("2026-09-15");
  });

  it("follows the clock change rather than a fixed offset", () => {
    // Indiana is UTC−5 in winter and UTC−4 in summer. A fixed −4 would put
    // the first instant on the 8th and a fixed −5 the second on the 31st.
    expect(todayIn(INDY, new Date("2026-03-08T04:30:00Z"))).toBe("2026-03-07");
    expect(todayIn(INDY, new Date("2026-11-01T04:30:00Z"))).toBe("2026-11-01");
  });

  it("throws on a timezone it cannot read", () => {
    expect(() => todayIn("America/Nowhere")).toThrow(RangeError);
  });
});

describe("isCalendarDate", () => {
  it.each(["2026-09-14", "2024-02-29", "2000-02-29", "2026-12-31"])(
    "accepts %s",
    (value) => {
      expect(isCalendarDate(value)).toBe(true);
    },
  );

  it.each([
    "2026-02-29", // not a leap year
    "1900-02-29", // divisible by 100 and not by 400
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-09-00",
    "2026-9-14",
    "2026-09-14T00:00:00Z", // a moment, not a date
    "",
  ])("refuses %j", (value) => {
    expect(isCalendarDate(value)).toBe(false);
  });
});

describe("firstOfMonth", () => {
  it("pins a date to the first of its month", () => {
    expect(firstOfMonth("2026-09-14")).toBe("2026-09-01");
    expect(firstOfMonth("2026-09-01")).toBe("2026-09-01");
    expect(firstOfMonth("2024-02-29")).toBe("2024-02-01");
  });

  it("refuses something that is not a date", () => {
    expect(() => firstOfMonth("2026-02-30")).toThrow(RangeError);
  });
});

describe("addMonths", () => {
  it("steps to the first of the month either side", () => {
    expect(addMonths("2026-09-01", 1)).toBe("2026-10-01");
    expect(addMonths("2026-09-01", -1)).toBe("2026-08-01");
    expect(addMonths("2026-09-01", 0)).toBe("2026-09-01");
  });

  it("crosses a year in both directions", () => {
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(addMonths("2026-09-01", -24)).toBe("2024-09-01");
  });

  it("lands on the first from any day, the 31st included", () => {
    // A month is not a number of days, so there is no 31 February to fall
    // into and no clamping rule to get wrong.
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-01");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-01");
  });

  it("refuses a fraction of a month", () => {
    expect(() => addMonths("2026-09-01", 0.5)).toThrow(RangeError);
  });
});

describe("addMonthsKeepingDay", () => {
  it("keeps the day of the month", () => {
    expect(addMonthsKeepingDay("2026-09-14", 3)).toBe("2026-12-14");
    expect(addMonthsKeepingDay("2026-09-14", -9)).toBe("2025-12-14");
  });

  it("falls back to a shorter month's last day", () => {
    expect(addMonthsKeepingDay("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsKeepingDay("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsKeepingDay("2026-08-31", 1)).toBe("2026-09-30");
  });

  it("is the 31st again two steps on, counted from the start", () => {
    expect(addMonthsKeepingDay("2026-01-31", 2)).toBe("2026-03-31");
  });
});

describe("addDays and daysBetween", () => {
  it("cross a month, a year and a leap day", () => {
    expect(addDays("2026-09-14", 30)).toBe("2026-10-14");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2100-02-28", 1)).toBe("2100-03-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("count the days between two dates, negative for an earlier one", () => {
    expect(daysBetween("2026-08-24", "2026-09-01")).toBe(8);
    expect(daysBetween("2026-09-01", "2026-08-24")).toBe(-8);
    expect(daysBetween("2026-09-14", "2026-09-14")).toBe(0);
    expect(daysBetween("2024-01-01", "2025-01-01")).toBe(366);
  });

  it("agree with each other across four centuries", () => {
    // Every day from 1900 to 2300, round-tripped: a slip in the era
    // arithmetic shows up on a century that is not a leap year.
    let date = "1900-01-01";
    for (let step = 0; step < 146_097; step += 37) {
      const next = addDays(date, 37);
      expect(daysBetween(date, next)).toBe(37);
      expect(isCalendarDate(next)).toBe(true);
      date = next;
    }
  });

  it("refuse a fraction of a day", () => {
    expect(() => addDays("2026-09-01", 0.5)).toThrow(RangeError);
  });
});

describe("yearOf", () => {
  it("is the calendar year, with no timezone to move it", () => {
    expect(yearOf("2026-12-31")).toBe(2026);
    expect(yearOf("2027-01-01")).toBe(2027);
  });
});

describe("formatDate", () => {
  it("renders the full form by default", () => {
    expect(formatDate("2026-09-14")).toBe("Sep 14, 2026");
    expect(formatDate("2026-09-03")).toBe("Sep 3, 2026");
  });

  it("renders the short and month forms", () => {
    expect(formatDate("2026-09-03", "short")).toBe("Sep 3");
    expect(formatDate("2019-06-01", "month")).toBe("Jun 2019");
    expect(formatDate("2026-09-01", "month-long")).toBe("September 2026");
    expect(formatDate("2026-09-01", "month-name")).toBe("September");
  });

  it("does not move a date across a day boundary", () => {
    // `new Date("2026-01-01")` is midnight UTC, which is New Year's Eve in
    // every American timezone; this never builds one.
    expect(formatDate("2026-01-01")).toBe("Jan 1, 2026");
  });

  it("refuses something that is not a date", () => {
    expect(() => formatDate("2026-09-14T00:00:00Z")).toThrow(RangeError);
  });
});

describe("isTimeZone", () => {
  it.each([INDY, "America/New_York", "UTC", "Pacific/Kiritimati"])(
    "accepts %s",
    (name) => {
      expect(isTimeZone(name)).toBe(true);
    },
  );

  it.each(["America/Nowhere", "", "  ", "Indianapolis", "+05:00:00:00"])(
    "refuses %j",
    (name) => {
      expect(isTimeZone(name)).toBe(false);
    },
  );

  it("agrees with todayIn about what it accepts", () => {
    // The point of asking Intl rather than a list: a name this passes is a
    // name the building's clock can be read in.
    expect(() => todayIn("US/Eastern")).not.toThrow();
    expect(isTimeZone("US/Eastern")).toBe(true);
  });
});
