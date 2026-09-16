"use client";

import { ChevronDownIcon } from "lucide-react";

import { useForecastParams } from "@/components/forecast/use-forecast-params";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDeferrals } from "@/lib/forecast/params";

const CHOICES = [
  { years: "0", label: "As forecast" },
  { years: "1", label: "Defer 1 year" },
  { years: "2", label: "Defer 2 years" },
  { years: "3", label: "Defer 3 years" },
] as const;

/**
 * `What if?` (`docs/ui/screens/capex-forecast.md`, the selected year): PRD
 * F3's sensitivity. A choice rewrites this item's entry in `?defer=` and the
 * server recomputes the chart, the figures and the reserve with the item
 * moved. **Nothing is saved** — deciding to defer has nowhere to be stored yet
 * (#96).
 *
 * A radio group rather than three actions, so the menu says which one the
 * chart is showing, and `As forecast` takes it back.
 */
export function WhatIfMenu({
  itemId,
  name,
  deferrals,
}: {
  itemId: string;
  /** `Roof, Sumner St` — the menu's name for a screen reader. */
  name: string;
  /** The page's deferrals, as the server kept them after checking each. */
  deferrals: [string, number][];
}) {
  const { navigate } = useForecastParams();
  const deferredBy = deferrals.find(([id]) => id === itemId)?.[1] ?? 0;

  function choose(years: string) {
    const next = new Map(deferrals);
    if (years === "0") next.delete(itemId);
    else next.set(itemId, Number(years));

    navigate((params) => {
      const defer = formatDeferrals(next);
      if (defer) params.set("defer", defer);
      else params.delete("defer");
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label={`What if? ${name}`}
          className="text-text-tertiary"
        >
          What if?
          <ChevronDownIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuRadioGroup
          value={String(deferredBy)}
          onValueChange={choose}
        >
          {CHOICES.map((choice) => (
            <DropdownMenuRadioItem key={choice.years} value={choice.years}>
              {choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
