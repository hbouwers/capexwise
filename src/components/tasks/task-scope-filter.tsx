"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import { TradeFilterChip } from "@/components/contacts/trade-chip";
import type { ScopeChip } from "@/components/buildings/equipment-filter";
import { Button } from "@/components/ui/button";

/**
 * The page's own URL with the recurring tasks' scope set to `scope`, and
 * every other param as it was — the rent roll's month and the equipment's
 * filters stay put. Its own param, `?taskScope=`, rather than the equipment
 * table's `?scope=`: the two tables filter separately.
 */
function useScopeNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (scope: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (scope) params.set("taskScope", scope);
    else params.delete("taskScope");

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
}

/**
 * The Recurring tasks' scope filter (`docs/ui/screens/README.md`, building or
 * unit): `All`, `Shared`, then each unit, as the equipment table has it — the
 * contact book's chip, a `<button>` with `aria-pressed`. The page filters on
 * the server, so a chip is a navigation; the pressed state moves at once.
 */
export function TaskScopeFilter({
  scopes,
  scope,
}: {
  scopes: ScopeChip[];
  scope: string | null;
}) {
  const navigate = useScopeNavigation();
  const [, startTransition] = useTransition();
  const [pressed, setPressed] = useOptimistic(scope);

  return (
    <div
      role="group"
      aria-label="Filter recurring tasks"
      className="flex gap-2 overflow-x-auto px-5 pb-1 md:flex-wrap md:overflow-visible md:pb-0"
    >
      {scopes.map((chip) => (
        <TradeFilterChip
          key={chip.scope ?? "all"}
          label={chip.label}
          count={chip.count}
          pressed={pressed === chip.scope}
          onClick={() =>
            startTransition(() => {
              // Pressing the chosen scope again goes back to all of them.
              const next = pressed === chip.scope ? null : chip.scope;
              setPressed(next);
              navigate(next);
            })
          }
        />
      ))}
    </div>
  );
}

/** `Clear filter`, for a table filtered to nothing. */
export function TaskScopeFilterClear() {
  const navigate = useScopeNavigation();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => navigate(null)}
    >
      Clear filter
    </Button>
  );
}
