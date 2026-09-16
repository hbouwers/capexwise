/**
 * The whole forecast page's arithmetic in one call
 * (`docs/ui/screens/capex-forecast.md`): the ten bars, the three figures, and
 * the reserve projection. A `What if?` deferral is the same call with
 * `deferrals` set, so the chart, the figures and the rail always move
 * together.
 */
import { type CalendarDate, monthOf, yearOf } from "@/lib/dates";
import { type Cents } from "@/lib/money";

import {
  type Deferrals,
  type ForecastItem,
  levelFundingPerMonthCents,
  outflowByYear,
  replacements,
  tenYearTotalCents,
  type YearOutflow,
} from "@/lib/forecast/outflow";
import {
  projectReserve,
  type Reserve,
  type ReserveProjection,
  reserveNeededPerMonthCents,
} from "@/lib/forecast/reserve";

export type Forecast = {
  thisYear: number;
  years: YearOutflow[];
  /** `10-year total`. */
  totalCents: Cents;
  /**
   * The total over 120 months — `Reserve needed / mo` until a reserve is
   * entered, labelled `to fund the next ten years evenly`.
   */
  levelFundingPerMonthCents: Cents;
  /** `null` until the org has entered a reserve. */
  reserve: {
    projection: ReserveProjection;
    /** `Reserve needed / mo`. */
    neededPerMonthCents: Cents;
  } | null;
};

/**
 * `today` is the date the forecast is as of, which decides this year and how
 * many contributions land before next January.
 */
export function forecast(input: {
  items: readonly ForecastItem[];
  today: CalendarDate;
  reserve: Reserve | null;
  deferrals?: Deferrals;
}): Forecast {
  const thisYear = yearOf(input.today);
  const thisMonth = monthOf(input.today);
  const years = outflowByYear(
    replacements(input.items, thisYear, input.deferrals),
    thisYear,
  );

  return {
    thisYear,
    years,
    totalCents: tenYearTotalCents(years),
    levelFundingPerMonthCents: levelFundingPerMonthCents(years),
    reserve: input.reserve && {
      projection: projectReserve(years, input.reserve, thisMonth),
      neededPerMonthCents: reserveNeededPerMonthCents(
        years,
        input.reserve.balanceCents,
        thisMonth,
      ),
    },
  };
}
