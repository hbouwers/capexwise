"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import { Field, fieldId, MoneyInput } from "@/components/field";
import { FooterQuestion, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { todayIn } from "@/lib/dates";
import {
  emptyExpenseFields,
  type ExpenseFields,
  expenseFields,
  NONE,
  nextExpenseFields,
  validateExpense,
} from "@/lib/expense-form";
import {
  asksClassification,
  CLASSIFICATION_LABELS,
  type Classification,
} from "@/lib/expenses";
import type { FieldErrors } from "@/lib/forms";
import { formatMoney } from "@/lib/money";
import {
  createExpense,
  deleteExpense,
  updateExpense,
} from "@/server/actions/expenses";
import type {
  ExpenseModal as ExpenseModalData,
  ExpenseModalBuilding,
} from "@/server/queries/expenses";

/**
 * The expense modal (`docs/ui/screens/expenses.md`): add an expense, or edit
 * and delete one. It lives in the URL — `?expense=new` or `?expense={id}` — on
 * the contact modal's pattern, so the back button closes it and an expense
 * can be linked to from the tax planner.
 *
 * **Built for a stack of receipts.** `Save and add another` keeps the date,
 * the building and the category, clears the rest, and puts focus back on
 * Amount — twelve months of receipts is the onboarding cost PRD §11 worries
 * about, arriving one field at a time.
 *
 * Every value is held as typed, and `validateExpense` — the server action's
 * own rules — runs before anything is sent, judging the date against today
 * where the chosen building is. **Closing a changed form asks first**, the
 * contact modal's rule.
 */

type Asking = null | "discard" | "delete";

const SAVE_FAILED =
  "Couldn’t save the expense. Check your connection and try again — what you typed is still here.";

/** Two fields side by side from `sm` up, stacked below it. */
function TwoUp({ children }: { children: ReactNode }) {
  return <div className="grid gap-5 sm:grid-cols-2 sm:gap-3">{children}</div>;
}

export function ExpenseModal({
  modal,
  closeHref,
  defaults,
}: {
  modal: Exclude<ExpenseModalData, { kind: "not-found" }>;
  /** The page's URL without the modal — the period and filters it was opened from. */
  closeHref: string;
  /** A new expense's building and category, from the page's filters. */
  defaults: { buildingId: string | null; category: string | null };
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const buildings: ExpenseModalBuilding[] =
    modal.kind === "new" ? modal.buildings : [modal.building];
  const readOnly = modal.kind === "edit" && modal.readOnly;

  const [initial, setInitial] = useState<ExpenseFields>(() => {
    if (modal.kind === "edit") return expenseFields(modal.expense);

    const buildingId = modal.buildingId ?? defaults.buildingId ?? "";
    const building = buildings.find((b) => b.id === buildingId);

    return emptyExpenseFields({
      today: todayIn(building?.timezone ?? buildings[0]!.timezone),
      buildingId: building
        ? buildingId
        : buildings.length === 1
          ? buildings[0]!.id
          : "",
      category:
        modal.categories.find((c) => c.slug === defaults.category)?.slug ?? "",
    });
  });
  const [open, setOpen] = useState(true);
  const [fields, setFields] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [asking, setAsking] = useState<Asking>(null);
  const [added, setAdded] = useState(0);
  const [pending, startTransition] = useTransition();

  const changed = JSON.stringify(fields) !== JSON.stringify(initial);
  const building = buildings.find((b) => b.id === fields.buildingId) ?? null;
  const today = todayIn(building?.timezone ?? buildings[0]!.timezone);
  const multiUnit = (building?.units.length ?? 0) > 1;
  const equipment = building?.equipment ?? [];
  const classified = asksClassification(
    fields.category,
    fields.equipment === NONE ? null : fields.equipment,
  );

  function leave() {
    setOpen(false);
    router.replace(closeHref, { scroll: false });
  }

  function onOpenChange(next: boolean) {
    if (next || pending) return;
    if (changed && !readOnly) {
      setAsking("discard");
      return;
    }
    // Something was added with `Save and add another`: the page behind has
    // new rows, and the replace below re-renders it.
    leave();
  }

  function set(patch: Partial<ExpenseFields>) {
    setFields((current) => ({ ...current, ...patch }));
    setAsking(null);
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key];
      delete next.form;
      return next;
    });
  }

  function focusFirstError() {
    requestAnimationFrame(() => {
      formRef.current
        ?.closest("[role=dialog]")
        ?.querySelector<HTMLElement>(
          '[aria-invalid="true"], [data-error-anchor]',
        )
        ?.focus();
    });
  }

  function save(another: boolean) {
    if (pending || readOnly) return;

    const checked = validateExpense(fields, today);
    if (!checked.ok) {
      setErrors(checked.errors);
      focusFirstError();
      return;
    }

    setErrors({});
    setAsking(null);

    startTransition(async () => {
      const result = await (
        modal.kind === "new"
          ? createExpense(fields)
          : updateExpense(modal.expense.id, fields)
      ).catch(() => null);

      if (result === null || !result.ok) {
        setErrors(result?.errors ?? { form: SAVE_FAILED });
        focusFirstError();
        return;
      }

      const amount = formatMoney(Math.abs(checked.values.amountCents), {
        form: "cents",
      });
      const what = fields.direction === "refund" ? "Refund" : "Expense";

      if (another) {
        const next = nextExpenseFields(fields);
        setInitial(next);
        setFields(next);
        setAdded((count) => count + 1);
        toast.success(`${what} of ${amount} added.`);
        router.refresh();
        requestAnimationFrame(() => amountRef.current?.focus());
        return;
      }

      toast.success(
        modal.kind === "new" ? `${what} of ${amount} added.` : `${what} saved.`,
      );
      leave();
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    save(false);
  }

  function remove() {
    if (modal.kind !== "edit") return;

    startTransition(async () => {
      const result = await deleteExpense(modal.expense.id).catch(() => ({
        ok: false,
      }));

      if (!result.ok) {
        setAsking(null);
        setErrors({
          form: "Couldn’t delete the expense. Reload the page and try again.",
        });
        focusFirstError();
        return;
      }

      toast.success("Expense deleted.");
      leave();
    });
  }

  const footer = readOnly ? (
    <div className="flex justify-end">
      <Button type="button" variant="outline" onClick={leave}>
        Close
      </Button>
    </div>
  ) : asking === "discard" ? (
    <FooterQuestion
      question="Discard your changes?"
      keep="Keep editing"
      confirm="Discard"
      onKeep={() => setAsking(null)}
      onConfirm={leave}
    />
  ) : asking === "delete" ? (
    <FooterQuestion
      question="Delete this expense?"
      detail="It comes off the ledger, the cash flow and the tax planner. For a refund, record one instead."
      keep="Keep"
      confirm={pending ? "Deleting…" : "Delete expense"}
      destructive
      disabled={pending}
      onKeep={() => setAsking(null)}
      onConfirm={remove}
    />
  ) : (
    <div className="flex flex-col gap-3">
      {errors.form ? (
        <p
          data-error-anchor
          tabIndex={-1}
          role="alert"
          className="text-xs leading-snug text-status-danger"
        >
          {errors.form}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {modal.kind === "edit" ? (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setAsking("delete")}
            >
              Delete expense
            </Button>
          ) : added > 0 ? (
            <p className="text-xs text-text-muted" aria-live="polite">
              {added === 1 ? "1 added" : `${added} added`}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {added > 0 && !changed ? "Done" : "Cancel"}
          </Button>
          {modal.kind === "new" ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => save(true)}
            >
              Save and add another
            </Button>
          ) : null}
          <Button type="submit" form="expense-form" disabled={pending}>
            {pending
              ? "Saving…"
              : modal.kind === "new"
                ? "Save"
                : "Save expense"}
          </Button>
        </div>
      </div>
    </div>
  );

  const category = modal.categories.find((c) => c.slug === fields.category);
  const contact = modal.contacts.find((c) => c.id === fields.contact);
  const item = equipment.find((i) => i.id === fields.equipment);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={modal.kind === "new" ? "New expense" : "Expense"}
      description={
        readOnly
          ? `On ${modal.building.name}, which is ${modal.building.status}. Kept for its history.`
          : undefined
      }
      width="560px"
      footer={footer}
    >
      <form
        id="expense-form"
        ref={formRef}
        onSubmit={onSubmit}
        noValidate
        className="flex flex-col gap-5"
      >
        <fieldset disabled={readOnly || pending} className="contents">
          <TwoUp>
            <Field name="occurredOn" label="Date" error={errors.occurredOn}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  max={today}
                  value={fields.occurredOn}
                  onChange={(event) => set({ occurredOn: event.target.value })}
                  className="font-mono tabular-nums"
                />
              )}
            </Field>
            <Field name="amount" label="Amount" error={errors.amount}>
              {(control) => (
                <MoneyInput
                  {...control}
                  ref={amountRef}
                  value={fields.amount}
                  onChange={(event) => set({ amount: event.target.value })}
                  autoFocus={modal.kind === "new"}
                />
              )}
            </Field>
          </TwoUp>

          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className="sr-only">Direction</legend>
            <RadioGroup
              value={fields.direction}
              onValueChange={(direction) =>
                set({ direction: direction as ExpenseFields["direction"] })
              }
              className="flex flex-wrap gap-x-5 gap-y-2"
            >
              {(
                [
                  ["out", "Money out"],
                  ["refund", "Refund"],
                ] as const
              ).map(([value, label]) => (
                <div key={value} className="flex items-center gap-2">
                  <RadioGroupItem
                    value={value}
                    id={fieldId(`direction-${value}`)}
                  />
                  <Label htmlFor={fieldId(`direction-${value}`)}>{label}</Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>

          <TwoUp>
            <Field name="buildingId" label="Building" error={errors.buildingId}>
              {(control) => (
                <Select
                  value={fields.buildingId}
                  disabled={readOnly || buildings.length === 1}
                  // A unit and an item belong to one building, so choosing
                  // another starts both over.
                  onValueChange={(next) =>
                    set({ buildingId: next, scope: "shared", equipment: NONE })
                  }
                >
                  <SelectTrigger {...control} className="w-full">
                    <SelectValue placeholder="Choose a building">
                      {building?.name}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {buildings.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
            {multiUnit && building ? (
              <Field name="scope" label="Scope">
                {(control) => (
                  <Select
                    value={fields.scope}
                    disabled={readOnly}
                    onValueChange={(next) => set({ scope: next })}
                  >
                    <SelectTrigger {...control} className="w-full">
                      <SelectValue>
                        {building.units.find((unit) => unit.id === fields.scope)
                          ?.label ?? "Shared"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="shared">Shared</SelectItem>
                      {building.units.map((unit) => (
                        <SelectItem key={unit.id} value={unit.id}>
                          {unit.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            ) : null}
          </TwoUp>

          <Field
            name="category"
            label="Schedule E category"
            error={errors.category}
          >
            {(control) => (
              <Select
                value={fields.category}
                disabled={readOnly}
                onValueChange={(next) => set({ category: next })}
              >
                <SelectTrigger {...control} className="w-full">
                  <SelectValue placeholder="Choose a category">
                    {category ? category.label : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent position="popper">
                  {modal.categories.map((option) => (
                    <SelectItem key={option.slug} value={option.slug}>
                      {option.label}
                      <span className="ml-2 font-mono text-2xs text-text-muted">
                        line {option.line}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          {classified ? (
            <fieldset className="flex min-w-0 flex-col gap-1.5">
              <legend className="mb-1.5 text-xs leading-none font-medium text-text-secondary">
                Repair or improvement
              </legend>
              <RadioGroup
                value={fields.classification || "unclassified"}
                onValueChange={(next) => set({ classification: next })}
                className="flex flex-wrap gap-x-5 gap-y-2"
              >
                {(
                  Object.entries(CLASSIFICATION_LABELS) as [
                    Classification,
                    string,
                  ][]
                ).map(([value, label]) => (
                  <div key={value} className="flex items-center gap-2">
                    <RadioGroupItem
                      value={value}
                      id={fieldId(`classification-${value}`)}
                    />
                    <Label htmlFor={fieldId(`classification-${value}`)}>
                      {label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
              <p className="text-xs leading-snug text-text-muted">
                A repair keeps it as it was; an improvement makes it better,
                longer-lived or fit for a new use, and is depreciated. Confirm
                the call with your CPA.
              </p>
            </fieldset>
          ) : null}

          <Field
            name="description"
            label="Description"
            optional
            error={errors.description}
          >
            {(control) => (
              <Input
                {...control}
                value={fields.description}
                onChange={(event) => set({ description: event.target.value })}
                autoComplete="off"
              />
            )}
          </Field>

          <TwoUp>
            <Field name="contact" label="Paid to" optional>
              {(control) => (
                <Select
                  value={fields.contact}
                  disabled={readOnly}
                  onValueChange={(next) => set({ contact: next })}
                >
                  <SelectTrigger {...control} className="w-full">
                    <SelectValue>
                      {contact?.name ?? "Nobody in the book"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value={NONE}>Nobody in the book</SelectItem>
                    {modal.contacts.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name}
                        {option.archived ? " (archived)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field name="equipment" label="Equipment" optional>
              {(control) => (
                <Select
                  value={fields.equipment}
                  disabled={readOnly || !building}
                  onValueChange={(next) => set({ equipment: next })}
                >
                  <SelectTrigger {...control} className="w-full">
                    <SelectValue>{item?.label ?? "None"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value={NONE}>None</SelectItem>
                    {equipment.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                        {option.inService ? "" : " (out of service)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </TwoUp>

          {modal.kind === "edit" && modal.expense.taskTitle && fields.taskId ? (
            <p className="text-xs leading-snug text-text-muted">
              For the task{" "}
              <Link
                href={`/maintenance?task=${modal.expense.taskId}`}
                className="text-accent underline-offset-3 hover:underline"
              >
                {modal.expense.taskTitle}
              </Link>
              .
            </p>
          ) : null}
        </fieldset>
      </form>
    </Modal>
  );
}
