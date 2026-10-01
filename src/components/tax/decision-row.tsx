"use client";

import { useRouter } from "next/navigation";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { DeltaValue, Money } from "@/components/money";
import { ScopeLabel } from "@/components/scope-label";
import { cn } from "@/lib/cn";
import type { Cents } from "@/lib/money";
import { classifyPlan } from "@/server/actions/tax";

type Call = "repair" | "improvement" | "unclassified";

const CALLS = [
  { value: "repair", label: "Repair" },
  { value: "improvement", label: "Improvement" },
] as const;

/**
 * One planned item on `Repair or improvement?`
 * (`docs/ui/screens/tax-planner.md`): the item, its cost, the call, and what
 * the call does to this year.
 *
 * **The control sets a value on a record**, so it is a radio group styled as
 * the segmented control, not tabs (`docs/ui/components.md` §7). An undecided
 * plan has neither selected.
 *
 * **The effect is the server's.** Choosing saves through `classifyPlan` and
 * refreshes the page, and the statement, the liability and this row's effect
 * all come back from `src/lib/tax/` together. Nothing is computed here, so
 * the figure on screen is never one the browser made up while it waited.
 */
export function DecisionRow({
  planId,
  name,
  buildingName,
  scope,
  costCents,
  classification,
  effect,
  year,
  underDeMinimis,
  thresholdCents,
}: {
  planId: string;
  name: string;
  /** Null on a single building's page, where it is plain. */
  buildingName: string | null;
  /** `Shared` or a unit's label; null on a single-unit building. */
  scope: string | null;
  costCents: Cents;
  classification: Call;
  /** The liability's change, or taxable income's before a rate is entered. */
  effect: { cents: Cents; of: "liability" | "taxable" };
  year: number;
  underDeMinimis: boolean;
  thresholdCents: Cents | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // What was chosen, shown while the save is in flight.
  const [chosen, setChosen] = useState<Call>(classification);
  const shown = pending ? chosen : classification;

  function choose(value: string) {
    if (value !== "repair" && value !== "improvement") return;
    if (value === classification) return;

    setChosen(value);
    startTransition(async () => {
      const result = await classifyPlan(planId, value).catch(() => null);

      if (!result?.ok) {
        toast.error(
          result === null
            ? "Couldn’t save the call. Check your connection and try again."
            : "That plan has changed since the page loaded. Reload to see it.",
        );
        return;
      }

      router.refresh();
    });
  }

  const labelId = `decision-${planId}`;

  // Laid out by the card's width rather than the viewport's: the card sits
  // beside the rail on a wide screen, so the viewport says little about the
  // room it has. One line when the card is wide, two when it is not, and the
  // control full width on a phone (`tax-planner.md`, narrow viewports).
  return (
    <li className="flex flex-col gap-3 py-3.5 @2xl:flex-row @2xl:items-center @2xl:gap-5">
      <div className="flex min-w-0 flex-1 items-baseline justify-between gap-4">
        <div className="min-w-0">
          <p
            id={labelId}
            className="flex flex-wrap items-center gap-1.5 text-sm leading-snug font-medium text-text-primary"
          >
            {name}
            {scope ? <ScopeLabel>{scope}</ScopeLabel> : null}
          </p>
          <p className="text-xs leading-snug text-text-muted">
            {buildingName ? `${buildingName} · ` : null}
            {underDeMinimis && thresholdCents !== null ? (
              <>
                Under the <Money cents={thresholdCents} /> de minimis threshold
              </>
            ) : (
              "Planned this year"
            )}
          </p>
        </div>
        <Money
          cents={costCents}
          className="shrink-0 text-sm text-text-primary"
        />
      </div>

      <div className="flex flex-col gap-2 @sm:flex-row @sm:items-center @sm:justify-between @sm:gap-5">
        <RadioGroupPrimitive.Root
          aria-labelledby={labelId}
          value={shown === "unclassified" ? "" : shown}
          onValueChange={choose}
          disabled={pending}
          orientation="horizontal"
          className="grid w-full grid-cols-2 rounded-md border border-border-control bg-surface-fill p-0.5 @sm:w-auto"
        >
          {CALLS.map((call) => (
            <RadioGroupPrimitive.Item
              key={call.value}
              value={call.value}
              className="rounded-sm px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary disabled:cursor-wait data-[state=checked]:bg-surface-card data-[state=checked]:text-text-primary data-[state=checked]:shadow-xs"
            >
              {call.label}
            </RadioGroupPrimitive.Item>
          ))}
        </RadioGroupPrimitive.Root>

        <div
          aria-busy={pending}
          className={cn(
            "flex items-baseline justify-between gap-2 transition-opacity @sm:w-28 @sm:flex-col @sm:items-end @sm:gap-0.5",
            // The old call's figure until the server answers for the new one.
            pending && "opacity-50",
          )}
        >
          {shown === "unclassified" ? (
            <span className="text-sm text-text-muted">No call made</span>
          ) : (
            <DeltaValue
              cents={effect.cents}
              className="text-sm text-text-primary"
            />
          )}
          <span className="text-2xs leading-tight text-text-muted">
            {effect.of === "liability"
              ? `tax effect ${year}`
              : `taxable income ${year}`}
          </span>
        </div>
      </div>
    </li>
  );
}
