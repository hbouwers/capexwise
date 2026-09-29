"use client";

import { ParamSelect } from "@/components/param-select";

/**
 * The ledger's Schedule E category filter, in `?category=`, on
 * `ParamSelect`'s rules.
 */
export function CategorySelect({
  categories,
  selected,
}: {
  categories: { slug: string; label: string }[];
  selected: string | null;
}) {
  return (
    <ParamSelect
      param="category"
      label="Category"
      allLabel="All categories"
      options={categories.map(({ slug, label }) => ({
        value: slug,
        label,
      }))}
      selected={selected}
    />
  );
}
