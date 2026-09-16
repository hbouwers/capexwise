"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Field, MoneyInput } from "@/components/field";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type InstallFields,
  validateConfirmation,
} from "@/lib/capital-item-form";
import type { CalendarDate } from "@/lib/dates";
import type { FieldErrors } from "@/lib/forms";
import { confirmCapitalItem } from "@/server/actions/capital-items";

const SAVE_FAILED =
  "Couldn’t confirm the item. Check your connection and try again — what you typed is still here.";

/**
 * `Confirm` on an estimated item (`docs/ui/screens/building-detail.md`,
 * Equipment & capital items): a small modal rather than a one-click write,
 * because PRD F2 has it ask for the actual install date and cost, and the
 * schema requires the date of an audited item.
 *
 * The date is required and the cost is not. **The cost is what the item did
 * cost** — its basis, for the tax planner — and not what replacing it will,
 * which the item editor changes (#125); the helper says so, because the table
 * beside it shows a replacement cost and the two are easy to confuse.
 *
 * `validateConfirmation`, the server action's own rules, runs before anything
 * is sent. Saving refreshes the page, and the row's badge flips from the
 * server's answer.
 */
export function ConfirmItem({
  itemId,
  label,
  estimatedYear,
  today,
}: {
  itemId: string;
  label: string;
  estimatedYear: number;
  /** Today where the building is — the latest an install can be dated. */
  today: CalendarDate;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<InstallFields>({
    installedOn: "",
    cost: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const formId = `confirm-${itemId}`;
  const name = (field: string) => `confirm-${itemId}-${field}`;

  function onOpenChange(next: boolean) {
    if (pending) return;

    setOpen(next);
    if (!next) {
      setFields({ installedOn: "", cost: "" });
      setErrors({});
    }
  }

  function set(key: keyof InstallFields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      delete next.form;
      return next;
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;

    const checked = validateConfirmation(fields, today);
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
      const result = await confirmCapitalItem(itemId, fields).catch(() => null);

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
      toast.success(`${label}: confirmed.`);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="link"
        size="xs"
        aria-label={`Confirm: ${label}`}
        onClick={() => setOpen(true)}
        className="px-0 text-accent max-md:h-11 max-md:text-sm"
      >
        Confirm
      </Button>
      {open ? (
        <Modal
          open
          onOpenChange={onOpenChange}
          title={`Confirm ${label}`}
          description={`Estimated as installed in ${estimatedYear}. Read the label or the invoice, and enter what it says.`}
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
                <Button type="submit" form={formId} disabled={pending}>
                  {pending ? "Confirming…" : "Confirm"}
                </Button>
              </div>
            </div>
          }
        >
          <form
            id={formId}
            ref={formRef}
            onSubmit={onSubmit}
            noValidate
            className="flex flex-col gap-4"
          >
            <Field
              name={name("installedOn")}
              label="Installed on"
              error={errors.installedOn}
            >
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  max={today}
                  value={fields.installedOn}
                  onChange={(event) => set("installedOn", event.target.value)}
                  autoFocus
                  className="font-mono tabular-nums"
                />
              )}
            </Field>
            <Field
              name={name("cost")}
              label="What it cost"
              optional
              helper="The price paid when it was installed — not what replacing it would cost."
              error={errors.cost}
            >
              {(control) => (
                <MoneyInput
                  {...control}
                  value={fields.cost}
                  onChange={(event) => set("cost", event.target.value)}
                />
              )}
            </Field>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
