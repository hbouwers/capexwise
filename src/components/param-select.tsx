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
 * A filter `Select` that lives in one search param: `All …` first, then each
 * option. Every other param stays as it was, apart from the ones named in
 * `clears`, and the page is not scrolled: the server filters, and the person
 * is already where the result will be. `BuildingSelect` and the expenses
 * page's category filter are built on it.
 */
export function ParamSelect({
  param,
  label,
  allLabel,
  options,
  selected,
  clears = [],
}: {
  param: string;
  /** The trigger's accessible name. */
  label: string;
  allLabel: string;
  options: { value: string; label: string }[];
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
      if (next === ALL) params.delete(param);
      else params.set(param, next);
      for (const name of clears) params.delete(name);

      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  return (
    <Select value={value} onValueChange={choose}>
      <SelectTrigger aria-label={label} className="w-full sm:w-56">
        <SelectValue>
          {options.find((option) => option.value === value)?.label ?? allLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="end">
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
