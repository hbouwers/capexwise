"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useOptimistic, useTransition } from "react";

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
 * A page header's building `Select` — the forecast's and Maintenance's:
 * `All buildings`, then each, in `?building=`. Every other param stays as it
 * was, apart from the ones named in `clears`, and the page is not scrolled:
 * the server filters, and the person is already where the result will be.
 *
 * `clears` is for a param that names something inside one building's view —
 * the forecast's deferrals name items, and one kept across a change of
 * building would be a change the person made to a different chart.
 */
export function BuildingSelect({
  buildings,
  selected,
  clears = [],
}: {
  buildings: { id: string; name: string }[];
  selected: string | null;
  clears?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [value, setValue] = useOptimistic(selected ?? ALL);

  function choose(next: string) {
    startTransition(() => {
      setValue(next);

      const params = new URLSearchParams(searchParams);
      if (next === ALL) params.delete("building");
      else params.set("building", next);
      for (const name of clears) params.delete(name);

      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  return (
    <Select value={value} onValueChange={choose}>
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
