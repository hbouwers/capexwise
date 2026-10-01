"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";

import { Field } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FieldErrors } from "@/lib/forms";
import { formatRate, validateRate } from "@/lib/tax/rate-form";
import { setTaxRate } from "@/server/actions/tax";

const SAVE_FAILED =
  "Couldn’t save the rate. Check your connection and try again — what you typed is still here.";

/**
 * The blended rate, as a field on the liability card
 * (`docs/ui/screens/tax-planner.md`, Estimated liability): a figure multiplied
 * by a rate nobody can see is not traceable, so the rate is on the card with
 * the figure, and there is no default to multiply by before it is entered.
 *
 * `validateRate`, the server action's own rules, runs before anything is sent.
 * Saving refreshes the page, and the liability is the server's answer.
 */
export function RateForm({
  rateBps,
  year,
}: {
  rateBps: number | null;
  year: number;
}) {
  const router = useRouter();
  const [rate, setRate] = useState(
    rateBps === null ? "" : formatRate(rateBps).replace(/%$/, ""),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;

    const checked = validateRate({ rate });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    if (checked.rateBps === rateBps) return;

    startTransition(async () => {
      const result = await setTaxRate({ rate }).catch(() => null);

      if (result === null) {
        setErrors({ rate: SAVE_FAILED });
        return;
      }
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }

      setErrors({});
      router.refresh();
      toast.success(`${year} rate saved.`);
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-label={`${year} blended rate`}>
      <Field
        name="tax-rate"
        label="Blended rate"
        helper="Federal and state together, on this income."
        error={errors.rate ?? errors.form}
      >
        {(control) => (
          // The button beside the input, so the helper and any message sit
          // under both.
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                {...control}
                inputMode="decimal"
                autoComplete="off"
                value={rate}
                onChange={(event) => {
                  setRate(event.target.value);
                  setErrors({});
                }}
                className="pr-7 font-mono tabular-nums"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-text-muted"
              >
                %
              </span>
            </div>
            <Button
              type="submit"
              variant={rateBps === null ? "default" : "outline"}
              disabled={pending}
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </Field>
    </form>
  );
}
