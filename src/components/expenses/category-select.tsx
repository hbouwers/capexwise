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
 * The ledger's Schedule E category filter, in `?category=`: `BuildingSelect`
 * for a category, with every other param kept and the page not scrolled.
 */
export function CategorySelect({
  categories,
  selected,
}: {
  categories: { slug: string; label: string }[];
  selected: string | null;
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
      if (next === ALL) params.delete("category");
      else params.set("category", next);

      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  return (
    <Select value={value} onValueChange={choose}>
      <SelectTrigger aria-label="Category" className="w-full sm:w-56">
        <SelectValue>
          {categories.find((category) => category.slug === value)?.label ??
            "All categories"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="end">
        <SelectItem value={ALL}>All categories</SelectItem>
        {categories.map((category) => (
          <SelectItem key={category.slug} value={category.slug}>
            {category.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
