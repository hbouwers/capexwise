import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/dates";
import { heatLevel } from "@/lib/tasks";

const HEAT = ["bg-heat-0", "bg-heat-1", "bg-heat-2", "bg-heat-3"] as const;

/** The height of each heat's bar, so the count reads without the colour. */
const HEIGHT = ["h-1.5", "h-4", "h-6", "h-8"] as const;

/**
 * `SeasonalStrip` (`docs/ui/components.md` §7): twelve months, January first,
 * each bar keyed on how many recurring tasks fall due in it — nothing, one or
 * two, three, four or more — with the month's initial beneath, always.
 *
 * **A list of twelve items, not twelve decorative boxes**: each bar carries its
 * text, `October: 4 tasks`, and the colour and height repeat
 * what it says. The current month's initial is `--text-primary`.
 */
export function SeasonalStrip({
  counts,
  currentMonth,
}: {
  /** Twelve counts, January first — `seasonalCounts()`. */
  counts: number[];
  /** `1` for January. */
  currentMonth: number;
}) {
  return (
    <ol className="grid grid-cols-12 gap-1">
      {counts.map((count, index) => {
        const month = index + 1;
        const name = formatDate(
          `2026-${String(month).padStart(2, "0")}-01`,
          "month-name",
        );
        const heat = heatLevel(count);

        return (
          <li key={month} className="flex flex-col items-center gap-1.5">
            <span className="sr-only">
              {name}: {count === 1 ? "1 task" : `${count} tasks`}
            </span>
            <span
              aria-hidden
              className="flex h-8 w-full items-end overflow-hidden rounded-sm bg-surface-subtle"
            >
              <span
                className={cn("w-full rounded-sm", HEAT[heat], HEIGHT[heat])}
              />
            </span>
            <span
              aria-hidden
              className={cn(
                "text-2xs leading-none",
                month === currentMonth
                  ? "font-semibold text-text-primary"
                  : "text-text-muted",
              )}
            >
              {name[0]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
