"use client";

import { ChevronDownIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { useForecastParams } from "@/components/forecast/use-forecast-params";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDeferrals } from "@/lib/forecast/params";
import { dropPlan, planReplacement } from "@/server/actions/planned-work";

const CHOICES = [
  { years: "0", label: "As forecast" },
  { years: "1", label: "Defer 1 year" },
  { years: "2", label: "Defer 2 years" },
  { years: "3", label: "Defer 3 years" },
] as const;

/** Every refusal is a page drawn before the item changed. */
const REFUSED = "Couldn’t save the plan. Reload the page and try again.";

/**
 * `What if?` (`docs/ui/screens/capex-forecast.md`, the selected year): PRD
 * F3's sensitivity. A choice rewrites this item's entry in `?defer=` and the
 * server recomputes the chart, the figures and the reserve with the item
 * moved.
 *
 * A radio group rather than three actions, so the menu says which one the
 * chart is showing, and `As forecast` takes it back.
 *
 * **A deferral is not saved until somebody says so** (#96). `Save as plan`
 * makes the year the chart is showing the item's plan, and takes the deferral
 * out of the URL, since the saved forecast now shows the same thing.
 * `Clear plan` drops a plan and puts the item back on its projection. A
 * deferral on a planned item moves it from the planned year.
 */
export function WhatIfMenu({
  itemId,
  name,
  deferrals,
  year,
  plannedYear,
}: {
  itemId: string;
  /** `Roof, Sumner St` — the menu's name for a screen reader. */
  name: string;
  /** The page's deferrals, as the server kept them after checking each. */
  deferrals: [string, number][];
  /** The year the chart shows this replacement in, deferral and all. */
  year: number;
  /** The item's live plan, or null. */
  plannedYear: number | null;
}) {
  const router = useRouter();
  const { navigate } = useForecastParams();
  const [pending, startTransition] = useTransition();
  const deferredBy = deferrals.find(([id]) => id === itemId)?.[1] ?? 0;

  function withoutThis(params: URLSearchParams, next: Map<string, number>) {
    next.delete(itemId);
    const defer = formatDeferrals(next);
    if (defer) params.set("defer", defer);
    else params.delete("defer");
  }

  function choose(years: string) {
    const next = new Map(deferrals);
    if (years !== "0") next.set(itemId, Number(years));

    navigate((params) => {
      if (years === "0") withoutThis(params, next);
      else params.set("defer", formatDeferrals(next)!);
    });
  }

  function saveAsPlan() {
    startTransition(async () => {
      const saved = await planReplacement(itemId, year);
      if (!saved.ok) {
        toast.error(REFUSED);
        return;
      }

      navigate((params) => withoutThis(params, new Map(deferrals)));
      toast.success(`Planned for ${year}.`);
    });
  }

  function clearPlan() {
    startTransition(async () => {
      const dropped = await dropPlan(itemId);
      if (!dropped.ok) {
        toast.error(REFUSED);
        return;
      }

      router.refresh();
      toast.success("Plan cleared. It’s back on its forecast year.");
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
          disabled={pending}
        >
          What if?
          <ChevronDownIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuRadioGroup
          value={String(deferredBy)}
          onValueChange={choose}
        >
          {CHOICES.map((choice) => (
            <DropdownMenuRadioItem key={choice.years} value={choice.years}>
              {choice.years === "0" && plannedYear !== null
                ? "As planned"
                : choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {deferredBy > 0 || plannedYear !== null ? (
          <DropdownMenuSeparator />
        ) : null}
        {deferredBy > 0 ? (
          <DropdownMenuItem onSelect={saveAsPlan}>
            Save as plan for {year}
          </DropdownMenuItem>
        ) : null}
        {plannedYear !== null && deferredBy === 0 ? (
          <DropdownMenuItem onSelect={clearPlan}>Clear plan</DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
