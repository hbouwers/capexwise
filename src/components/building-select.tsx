"use client";

import { ParamSelect } from "@/components/param-select";

/**
 * A page header's building `Select` — the forecast's, Maintenance's and the
 * expenses page's: `All buildings`, then each, in `?building=`, on
 * `ParamSelect`'s rules.
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
  return (
    <ParamSelect
      param="building"
      label="Building"
      allLabel="All buildings"
      options={buildings.map(({ id, name }) => ({ value: id, label: name }))}
      selected={selected}
      clears={clears}
    />
  );
}
