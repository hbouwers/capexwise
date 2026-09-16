"use client";

import { useOptimistic, useTransition } from "react";

import { useForecastParams } from "@/components/forecast/use-forecast-params";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Radix refuses an empty string as an item's value. */
const ALL = "all";

/**
 * The page header's building `Select` (`docs/ui/screens/capex-forecast.md`):
 * `All buildings`, then each, in `?building=`.
 *
 * **Choosing a building clears the deferrals.** A deferral names an item, and
 * the items forecast change with the building — one on another building would
 * be dropped from the URL on render anyway, and one kept would be a change
 * the person made to a different chart.
 */
export function BuildingSelect({
  buildings,
  selected,
}: {
  buildings: { id: string; name: string }[];
  selected: string | null;
}) {
  const { navigate } = useForecastParams();
  const [, startTransition] = useTransition();
  const [value, setValue] = useOptimistic(selected ?? ALL);

  return (
    <Select
      value={value}
      onValueChange={(next) =>
        startTransition(() => {
          setValue(next);
          navigate((params) => {
            if (next === ALL) params.delete("building");
            else params.set("building", next);
            params.delete("defer");
          });
        })
      }
    >
      <SelectTrigger aria-label="Building" className="w-full sm:w-56">
        <SelectValue>
          {buildings.find((building) => building.id === value)?.name ??
            "All buildings"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="end">
        <SelectItem value={ALL}>All buildings</SelectItem>
        {buildings.map((building) => (
          <SelectItem key={building.id} value={building.id}>
            {building.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
