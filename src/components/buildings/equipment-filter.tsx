"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import { TradeFilterChip } from "@/components/contacts/trade-chip";
import { Button } from "@/components/ui/button";

/** One scope chip: `All` (null), `Shared`, or a unit, with its count. */
export type ScopeChip = { scope: string | null; label: string; count: number };

type Filters = { scope: string | null; estimatedOnly: boolean };

/**
 * A navigation to the page with the table's filters set to `next` and every
 * other param as it was — so the rent roll's month stays put while the table
 * is filtered. Not scrolled: the table is where the person already is.
 */
function useFilterNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (next: Filters) => {
    const params = new URLSearchParams(searchParams);
    if (next.scope) params.set("scope", next.scope);
    else params.delete("scope");
    if (next.estimatedOnly) params.set("confidence", "estimated");
    else params.delete("confidence");

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
}

/**
 * The equipment table's filters (`docs/ui/screens/building-detail.md`,
 * Equipment & capital items): the scope filter on a building with more than
 * one unit, and `Estimated only` — the target of every "audit these items"
 * link in the product. Both in the URL, `?scope=` and `?confidence=estimated`.
 *
 * The contact book's chip (`screens/README.md`, building or unit): a
 * `<button>` with `aria-pressed`. The page filters on the server, so a chip is
 * a navigation; the pressed state moves at once and the rows follow.
 *
 * Below `md` the row scrolls sideways inside itself rather than wrapping, as
 * the trade filter's does.
 */
export function EquipmentFilter({
  scopes,
  scope,
  estimatedOnly,
  estimatedCount,
}: {
  /** Empty on a single-unit building, which shows no scope at all. */
  scopes: ScopeChip[];
  scope: string | null;
  estimatedOnly: boolean;
  estimatedCount: number;
}) {
  const navigate = useFilterNavigation();
  const [, startTransition] = useTransition();
  const [view, setView] = useOptimistic<Filters>({ scope, estimatedOnly });

  function choose(next: Filters) {
    startTransition(() => {
      setView(next);
      navigate(next);
    });
  }

  return (
    <div
      role="group"
      aria-label="Filter equipment"
      className="flex gap-2 overflow-x-auto px-5 pb-1 md:flex-wrap md:overflow-visible md:pb-0"
    >
      {scopes.map((chip) => (
        <TradeFilterChip
          key={chip.scope ?? "all"}
          label={chip.label}
          count={chip.count}
          pressed={view.scope === chip.scope}
          onClick={() =>
            choose({
              ...view,
              // Pressing the chosen scope again goes back to all of them.
              scope: view.scope === chip.scope ? null : chip.scope,
            })
          }
        />
      ))}
      <TradeFilterChip
        label="Estimated only"
        count={estimatedCount}
        pressed={view.estimatedOnly}
        onClick={() => choose({ ...view, estimatedOnly: !view.estimatedOnly })}
      />
    </div>
  );
}

/** `Clear filter`, for a table filtered to nothing. */
export function EquipmentFilterClear() {
  const navigate = useFilterNavigation();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => navigate({ scope: null, estimatedOnly: false })}
    >
      Clear filter
    </Button>
  );
}

/**
 * `Show replaced and removed` at the table's foot, and `Hide` once they are
 * shown (`building-detail.md`, the item editor). In the URL as
 * `?history=shown`, like the filters, and leaving every other param as it
 * was: the muted rows are still there after a save refreshes the page.
 */
export function EquipmentHistoryToggle({
  shown,
  count,
}: {
  shown: boolean;
  count: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [view, setView] = useOptimistic(shown);

  function toggle() {
    const params = new URLSearchParams(searchParams);
    if (view) params.delete("history");
    else params.set("history", "shown");

    const query = params.toString();
    startTransition(() => {
      setView(!view);
      router.push(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    });
  }

  return (
    <Button
      type="button"
      variant="link"
      size="xs"
      aria-pressed={view}
      onClick={toggle}
      className="px-0 text-accent max-md:h-11 max-md:text-sm"
    >
      {view
        ? "Hide replaced and removed"
        : `Show replaced and removed (${count})`}
    </Button>
  );
}
