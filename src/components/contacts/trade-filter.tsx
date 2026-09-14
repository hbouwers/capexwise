"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import { TradeFilterChip } from "@/components/contacts/trade-chip";
import {
  type ContactsView,
  contactsHref,
  type TradeCount,
} from "@/lib/contacts";

/**
 * The book's trade filter (`docs/ui/screens/contacts.md`, trade filter): `All`,
 * then only the trades somebody has, each with its count. One trade at a time,
 * in `?trade=`, so the task modal can link to a filtered book and the back
 * button undoes a choice.
 *
 * The page filters on the server, so a chip is a navigation. The pressed state
 * moves at once, optimistically, and the cards follow when the page does.
 *
 * Below `md` the row stops wrapping and scrolls sideways inside itself, `All`
 * first — nineteen wrapped chips would push the first contact below the fold.
 */
export function TradeFilter({
  chips,
  view,
  shown,
  total,
}: {
  chips: TradeCount[];
  view: ContactsView;
  shown: number;
  total: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [active, setActive] = useOptimistic(view.trade);

  function choose(trade: string | null) {
    startTransition(() => {
      setActive(trade);
      router.push(contactsHref({ ...view, trade, contact: null }), {
        scroll: false,
      });
    });
  }

  return (
    <section
      aria-labelledby="trade-filter-label"
      className="flex flex-col gap-3 rounded-lg border border-border-card bg-surface-card py-4"
    >
      <div className="flex items-baseline justify-between gap-3 px-5">
        <h2 id="trade-filter-label" className="field-label">
          Filter by trade
        </h2>
        <p aria-live="polite" className="text-xs leading-none text-text-muted">
          {shown} of {total} shown
        </p>
      </div>

      <div
        role="group"
        aria-labelledby="trade-filter-label"
        className="flex gap-2 overflow-x-auto px-5 pb-1 md:flex-wrap md:overflow-visible md:pb-0"
      >
        <TradeFilterChip
          label="All"
          count={total}
          pressed={active === null}
          onClick={() => choose(null)}
        />
        {chips.map((chip) => (
          <TradeFilterChip
            key={chip.slug}
            label={chip.label}
            count={chip.count}
            pressed={active === chip.slug}
            // Pressing the chosen trade again goes back to everyone.
            onClick={() => choose(active === chip.slug ? null : chip.slug)}
          />
        ))}
      </div>
    </section>
  );
}
