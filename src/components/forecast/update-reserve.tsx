"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Field, MoneyInput } from "@/components/field";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CalendarDate } from "@/lib/dates";
import type { FieldErrors } from "@/lib/forms";
import { type Cents, formatMoney } from "@/lib/money";
import { type ReserveFields, validateReserve } from "@/lib/reserve-form";
import { updateReserve } from "@/server/actions/reserve";

const SAVE_FAILED =
  "Couldn’t save the reserve. Check your connection and try again — what you typed is still here.";

/** A prefill that reads back as the same cents — `formatMoney`'s exact form. */
function typed(cents: Cents): string {
  return formatMoney(cents, { form: "cents" }).replace(/^\$/, "");
}

/**
 * `Update reserve` (`docs/ui/screens/capex-forecast.md`, Reserve projection):
 * the balance, the day it was read, and the monthly contribution, **all three
 * required and saved together**, because the schema stores a reserve whole.
 * The date defaults to today and cannot be later; `$0` is accepted for either
 * amount.
 *
 * `validateReserve`, the server action's own rules, runs before anything is
 * sent. Saving refreshes the page, and the projection is the server's answer.
 */
export function UpdateReserve({
  current,
  today,
  variant = "outline",
}: {
  current: {
    balanceCents: Cents;
    asOf: CalendarDate;
    monthlyContributionCents: Cents;
  } | null;
  /** The forecast's today — the latest a balance can be dated. */
  today: CalendarDate;
  variant?: "default" | "outline";
}) {
  const router = useRouter();
  const initial = (): ReserveFields => ({
    balance: current ? typed(current.balanceCents) : "",
    // A new reading is today's; the old date is the one being replaced.
    asOf: today,
    contribution: current ? typed(current.monthlyContributionCents) : "",
  });

  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<ReserveFields>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function onOpenChange(next: boolean) {
    if (pending) return;

    setOpen(next);
    if (next) setFields(initial());
    else setErrors({});
  }

  function set(key: keyof ReserveFields, value: string) {
    setFields((existing) => ({ ...existing, [key]: value }));
    setErrors((existing) => {
      const next = { ...existing };
      delete next[key];
      delete next.form;
      return next;
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;

    const checked = validateReserve(fields, today);
    if (!checked.ok) {
      setErrors(checked.errors);
      requestAnimationFrame(() =>
        formRef.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus(),
      );
      return;
    }

    startTransition(async () => {
      const result = await updateReserve(fields).catch(() => null);

      if (result === null) {
        setErrors({ form: SAVE_FAILED });
        return;
      }

      if (!result.ok) {
        setErrors(result.errors);
        return;
      }

      setOpen(false);
      router.refresh();
      toast.success("Reserve updated.");
    });
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size="sm"
        onClick={() => onOpenChange(true)}
      >
        Update reserve
      </Button>
      {open ? (
        <Modal
          open
          onOpenChange={onOpenChange}
          title="Update reserve"
          description="What the account holds, the day you read it, and what you add each month. The projection starts from this balance."
          width="480px"
          footer={
            <div className="flex flex-col gap-3">
              {errors.form ? (
                <p
                  role="alert"
                  className="text-xs leading-snug text-status-danger"
                >
                  {errors.form}
                </p>
              ) : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" form="update-reserve" disabled={pending}>
                  {pending ? "Saving…" : "Save reserve"}
                </Button>
              </div>
            </div>
          }
        >
          <form
            id="update-reserve"
            ref={formRef}
            onSubmit={onSubmit}
            noValidate
            className="flex flex-col gap-4"
          >
            <Field
              name="reserve-balance"
              label="Balance"
              error={errors.balance}
            >
              {(control) => (
                <MoneyInput
                  {...control}
                  value={fields.balance}
                  onChange={(event) => set("balance", event.target.value)}
                  autoFocus
                />
              )}
            </Field>
            <Field name="reserve-asOf" label="As of" error={errors.asOf}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  max={today}
                  value={fields.asOf}
                  onChange={(event) => set("asOf", event.target.value)}
                  className="font-mono tabular-nums"
                />
              )}
            </Field>
            <Field
              name="reserve-contribution"
              label="Monthly contribution"
              helper="What you add each month. The first counts next month."
              error={errors.contribution}
            >
              {(control) => (
                <MoneyInput
                  {...control}
                  value={fields.contribution}
                  onChange={(event) => set("contribution", event.target.value)}
                />
              )}
            </Field>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
