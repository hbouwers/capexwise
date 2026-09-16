/**
 * What the forecast page keeps in its URL (`docs/ui/screens/capex-forecast.md`,
 * `screens/README.md`, what the URL holds): the building in `?building=`, the
 * selected year in `?year=`, and the `What if?` deferrals in `?defer=`. Read
 * here and written here, so the page, the chart and the menu agree on the
 * spelling.
 */
import { type CalendarDate, todayIn } from "@/lib/dates";

import { type Deferrals, FORECAST_YEARS } from "@/lib/forecast/outflow";

/** A search param as a page receives it. */
type Param = string | string[] | undefined;

/**
 * `?year=`: one of the ten years, or this year for anything else — a missing
 * param, a year the chart does not draw, or something that is not a year.
 */
export function parseForecastYear(raw: Param, thisYear: number): number {
  if (typeof raw !== "string" || !/^\d{4}$/.test(raw)) return thisYear;

  const year = Number(raw);
  return year >= thisYear && year < thisYear + FORECAST_YEARS ? year : thisYear;
}

/**
 * `?defer={itemId}:{years},…`, read against the items the page is forecasting.
 *
 * **An entry that changes nothing is dropped**, and `dropped` says so, so the
 * page can take it out of the URL: an item that no longer exists or is not in
 * the building shown, a number of years that is not one, two or three, an
 * entry that is not `id:years` at all, and a second entry for an item already
 * deferred. A bar saying `Showing 1 change` over a chart that did not change
 * would be worse than no bar.
 */
export function parseDeferrals(
  raw: Param,
  itemIds: ReadonlySet<string>,
): { deferrals: Map<string, number>; dropped: boolean } {
  const deferrals = new Map<string, number>();
  if (raw === undefined) return { deferrals, dropped: false };
  if (typeof raw !== "string") return { deferrals, dropped: true };

  let dropped = false;
  for (const entry of raw.split(",")) {
    const match = /^([^:]+):([123])$/.exec(entry);
    const id = match?.[1];

    if (!match || !id || !itemIds.has(id) || deferrals.has(id)) {
      dropped = true;
      continue;
    }

    deferrals.set(id, Number(match[2]));
  }

  return { deferrals, dropped };
}

/** The `?defer=` value for a set of deferrals, or null for none. */
export function formatDeferrals(deferrals: Deferrals): string | null {
  const entries = [...deferrals].map(([id, years]) => `${id}:${years}`);

  return entries.length === 0 ? null : entries.join(",");
}

/**
 * A forecast URL. This year is the page with no `?year=`, as the current month
 * is the rent roll with no `?month=`.
 */
export function forecastHref({
  building,
  year,
  thisYear,
  deferrals,
}: {
  building?: string | null;
  year?: number | null;
  thisYear?: number;
  deferrals?: Deferrals;
}): string {
  const params = new URLSearchParams();
  if (building) params.set("building", building);
  if (year != null && year !== thisYear) params.set("year", String(year));
  const defer = deferrals ? formatDeferrals(deferrals) : null;
  if (defer) params.set("defer", defer);

  const query = params.toString();
  return query ? `/forecast?${query}` : "/forecast";
}

/**
 * The day a forecast across several buildings is as of: **the latest of their
 * todays**. "Today" is today where the building is (ADR-0005), and an org has
 * no timezone of its own, so on the night the year turns in one building and
 * not yet in another, the forecast has turned — a replacement due in the new
 * year is due somewhere already. Every other night of the year the buildings
 * agree on the year, and the month differs by at most one day's worth of it.
 *
 * UTC when there is no building, which is a forecast with nothing in it.
 */
export function forecastToday(
  timeZones: readonly string[],
  now: Date = new Date(),
): CalendarDate {
  if (timeZones.length === 0) return todayIn("UTC", now);

  return timeZones
    .map((zone) => todayIn(zone, now))
    .reduce((latest, today) => (today > latest ? today : latest));
}
