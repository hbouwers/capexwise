"use client";

import { ChevronDownIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { ConfidenceBadge } from "@/components/confidence-badge";
import { Field, fieldId, MoneyInput } from "@/components/field";
import { FooterQuestion, Modal } from "@/components/modal";
import { ScopeLabel } from "@/components/scope-label";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Textarea } from "@/components/ui/textarea";
import {
  type InstallFields,
  type ItemFields,
  itemFields,
  validateCapitalItem,
  validateReplacement,
} from "@/lib/capital-item-form";
import { CAPITAL_ITEM_GROUP_LABELS } from "@/lib/capital-items";
import { cn } from "@/lib/cn";
import type { CalendarDate } from "@/lib/dates";
import type { FieldErrors } from "@/lib/forms";
import {
  recordReplacement,
  removeCapitalItem,
  updateCapitalItem,
} from "@/server/actions/capital-items";
import type { EquipmentItem } from "@/server/queries/capital-items";

/** A unit the scope `Select` offers, or the retired one the item is on. */
export type EditorUnit = { id: string; label: string; retired: boolean };

/** What the footer is doing: the form's buttons, or one of these instead. */
type Asking = null | "discard" | "replace" | "remove";

const UNSAVED = "Your changes to this form won’t be saved.";

const SAVE_FAILED =
  "Couldn’t save the item. Check your connection and try again — what you typed is still here.";

/**
 * The item editor (`docs/ui/screens/building-detail.md`, Equipment & capital
 * items), PRD F2: the equipment table's `Item` button, and the modal it opens
 * with the item's fields — label, install year and confidence, the install
 * date when audited, what it cost, expected life, replacement cost, scope,
 * notes — and the two actions that are not edits:
 *
 * - **`Record replacement`** asks for the new item's install date and cost,
 *   and `recordReplacement` makes it a new, audited row with this one marked
 *   replaced. It never edits this row's install year.
 * - **`Remove`** marks the item removed, for equipment that is gone and not
 *   replaced.
 *
 * Both replace the footer rather than opening a second dialog, as the task
 * modal's `Mark done` and `Cancel task` do, and say so when they would drop
 * what was typed. `Confirm` is reachable here too — it is how an estimated
 * item is confirmed on a narrow viewport, where the table's Installed column
 * is folded — and is the same form as the row's: choose Audited, enter the
 * date, save.
 *
 * Open state is local, not the URL: nothing links to an item yet. The modal
 * mounts on open and unmounts on close, so every opening starts from the row.
 * On an archived or sold building the editor opens read-only — kept for its
 * history, as every write refuses it.
 */
export function ItemEditor({
  item,
  units,
  showScope,
  today,
  editable,
  className,
}: {
  item: EquipmentItem;
  /** The building's units, retired ones included, in label order. */
  units: EditorUnit[];
  /** False on a single-unit building, which shows no scope anywhere. */
  showScope: boolean;
  /** Today where the building is — the latest an install can be dated. */
  today: CalendarDate;
  editable: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cn(
          "block max-w-full truncate rounded-sm text-left text-sm font-medium text-text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none max-md:min-h-11",
          className,
        )}
      >
        {item.label}
      </button>
      {open ? (
        <ItemEditorModal
          item={item}
          units={units}
          showScope={showScope}
          today={today}
          readOnly={!editable}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function ItemEditorModal({
  item,
  units,
  showScope,
  today,
  readOnly,
  onClose,
}: {
  item: EquipmentItem;
  units: EditorUnit[];
  showScope: boolean;
  today: CalendarDate;
  readOnly: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const askedFrom = useRef<HTMLElement | null>(null);
  const [pending, startTransition] = useTransition();

  const [initial] = useState<ItemFields>(() => itemFields(item));
  const [open, setOpen] = useState(true);
  const [fields, setFields] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [asking, setAsking] = useState<Asking>(null);
  const [replacement, setReplacement] = useState<InstallFields>({
    installedOn: today,
    cost: "",
  });
  // The replacement's own errors, apart from the form's: its date and cost
  // share their keys with the form's audited date and basis, and a wrong
  // replacement date is not a wrong install date.
  const [replacementErrors, setReplacementErrors] = useState<FieldErrors>({});

  const changed = JSON.stringify(fields) !== JSON.stringify(initial);
  const estimated = fields.confidence === "estimated";

  const formId = `item-${item.id}`;
  const name = (field: string) => `item-${item.id}-${field}`;

  // The units the item can be put on: every one still leasable, and the
  // retired one it is on already, which keeps what it has (§7).
  const scopes = units.filter(
    (unit) => !unit.retired || unit.id === item.unitId,
  );
  const scopeLabel =
    fields.scope === "shared"
      ? "Shared"
      : (units.find((unit) => unit.id === fields.scope)?.label ?? "Shared");
  const category =
    item.group === null ? null : CAPITAL_ITEM_GROUP_LABELS[item.group];

  function leave() {
    setOpen(false);
    onClose();
  }

  function ask(question: Exclude<Asking, null>) {
    askedFrom.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setErrors((current) => {
      const next = { ...current };
      delete next.form;
      return next;
    });
    setAsking(question);
  }

  /** Back to the form, and focus back where it was — the task modal's. */
  function keep() {
    setAsking(null);
    requestAnimationFrame(() => {
      const from = askedFrom.current;
      const target = from?.isConnected
        ? from
        : formRef.current
            ?.closest("[role=dialog]")
            ?.querySelector<HTMLElement>("[data-more]");
      target?.focus();
    });
  }

  function onOpenChange(next: boolean) {
    if (next || pending) return;
    if (changed && !readOnly) {
      ask("discard");
      return;
    }
    leave();
  }

  function set(next: Partial<ItemFields>) {
    setFields((current) => ({ ...current, ...next }));
    setAsking(null);
    setErrors((current) => {
      const kept = { ...current };
      for (const key of Object.keys(next)) delete kept[key];
      delete kept.form;
      return kept;
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

  /**
   * `Confirm`, from the editor: the same change as the row's `Confirm` makes,
   * as an edit — Audited, with the date to enter next.
   */
  function confirm() {
    set({ confidence: "audited" });
    requestAnimationFrame(() =>
      document.getElementById(fieldId(name("installedOn")))?.focus(),
    );
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending || readOnly) return;

    const checked = validateCapitalItem(fields, today);
    if (!checked.ok) {
      setErrors(checked.errors);
      focusFirstError();
      return;
    }

    setErrors({});
    startTransition(async () => {
      const result = await updateCapitalItem(item.id, fields).catch(() => null);

      if (result === null || !result.ok) {
        setErrors(result?.errors ?? { form: SAVE_FAILED });
        focusFirstError();
        return;
      }

      toast.success(`${checked.values.label}: saved.`);
      router.refresh();
      leave();
    });
  }

  function replace() {
    const checked = validateReplacement(replacement, today, item);
    if (!checked.ok) {
      setReplacementErrors(checked.errors);
      focusFirstError();
      return;
    }

    setReplacementErrors({});
    startTransition(async () => {
      const result = await recordReplacement(item.id, replacement).catch(
        () => null,
      );

      if (result === null || !result.ok) {
        const { form, ...fields } = result?.errors ?? {
          form: "Couldn’t record the replacement. Check your connection and try again.",
        };
        setReplacementErrors(fields);
        setErrors(form ? { form } : {});
        focusFirstError();
        return;
      }

      toast.success(
        `${item.label}: replaced. The one it replaces is kept in the history.`,
      );
      router.refresh();
      leave();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await removeCapitalItem(item.id).catch(() => null);

      if (result === null || !result.ok) {
        setAsking(null);
        setErrors(
          result?.errors ?? {
            form: "Couldn’t remove the item. Reload the page and try again.",
          },
        );
        focusFirstError();
        return;
      }

      toast.success(`${item.label}: removed.`);
      router.refresh();
      leave();
    });
  }

  const formError = errors.form ? (
    <p
      data-error-anchor
      tabIndex={-1}
      role="alert"
      className="text-xs leading-snug text-status-danger"
    >
      {errors.form}
    </p>
  ) : null;

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
      onKeep={keep}
      onConfirm={leave}
    />
  ) : asking === "remove" ? (
    <FooterQuestion
      question={`Remove ${item.label}?`}
      detail={[
        "For equipment that is gone and not replaced. It leaves the table and the forecast, and stays in the history.",
        changed ? UNSAVED : null,
      ]
        .filter(Boolean)
        .join(" ")}
      keep="Keep item"
      confirm={pending ? "Removing…" : "Remove"}
      destructive
      disabled={pending}
      onKeep={keep}
      onConfirm={remove}
    />
  ) : asking === "replace" ? (
    <div
      role="group"
      aria-label={`Record a replacement of ${item.label}`}
      className="flex flex-col gap-3"
    >
      <p className="text-sm leading-tight font-medium text-text-primary">
        The new one
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Field
          name={name("replacement-installedOn")}
          label="Installed on"
          error={replacementErrors.installedOn}
          className="sm:w-44"
        >
          {(control) => (
            <Input
              {...control}
              type="date"
              max={today}
              value={replacement.installedOn}
              onChange={(event) => {
                setReplacement((r) => ({
                  ...r,
                  installedOn: event.target.value,
                }));
                setReplacementErrors({});
              }}
              autoFocus
              className="font-mono tabular-nums"
            />
          )}
        </Field>
        <Field
          name={name("replacement-cost")}
          label="What it cost"
          optional
          error={replacementErrors.cost}
          className="sm:w-36"
        >
          {(control) => (
            <MoneyInput
              {...control}
              value={replacement.cost}
              onChange={(event) => {
                setReplacement((r) => ({ ...r, cost: event.target.value }));
                setReplacementErrors({});
              }}
            />
          )}
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:mt-5.5 sm:ml-auto sm:flex-row">
          <Button type="button" variant="outline" onClick={keep}>
            Back
          </Button>
          <Button type="button" disabled={pending} onClick={replace}>
            {pending ? "Recording…" : "Record replacement"}
          </Button>
        </div>
      </div>
      <p className="text-xs leading-snug text-text-muted">
        The new item takes this one’s place, audited from that day. This one
        keeps its year and its cost in the history.
        {changed ? ` ${UNSAVED}` : null}
      </p>
      {formError}
    </div>
  ) : (
    <div className="flex flex-col gap-3">
      {formError}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                data-more
              >
                More
                <ChevronDownIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem onSelect={() => ask("replace")}>
                Record replacement
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => ask("remove")}
              >
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {item.confidence === "estimated" && estimated ? (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={confirm}
            >
              Confirm
            </Button>
          ) : null}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );

  const meta = (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      {category ? (
        <span className="text-xs text-text-secondary">{category}</span>
      ) : null}
      {showScope ? <ScopeLabel>{scopeLabel}</ScopeLabel> : null}
      <ConfidenceBadge confidence={item.confidence} />
    </div>
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={item.label}
      description={
        readOnly
          ? "The building is kept for its history — its equipment is read-only."
          : undefined
      }
      meta={meta}
      width="560px"
      footer={footer}
    >
      <form
        id={formId}
        ref={formRef}
        onSubmit={onSubmit}
        noValidate
        aria-label={`Edit ${item.label}`}
      >
        <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-5">
          <Field name={name("label")} label="Item" error={errors.label}>
            {(control) => (
              <Input
                {...control}
                value={fields.label}
                onChange={(event) => set({ label: event.target.value })}
                autoComplete="off"
              />
            )}
          </Field>

          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className="mb-1.5 text-xs leading-none font-medium text-text-secondary">
              Install year is
            </legend>
            <RadioGroup
              value={fields.confidence}
              onValueChange={(confidence) => set({ confidence })}
              className="flex flex-wrap gap-x-5 gap-y-2"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  value="estimated"
                  id={fieldId(name("confidence-estimated"))}
                />
                <Label htmlFor={fieldId(name("confidence-estimated"))}>
                  Estimated
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  value="audited"
                  id={fieldId(name("confidence-audited"))}
                />
                <Label htmlFor={fieldId(name("confidence-audited"))}>
                  Audited — read off the label or invoice
                </Label>
              </div>
            </RadioGroup>
          </fieldset>

          <TwoUp>
            {estimated ? (
              <Field
                name={name("installYear")}
                label="Install year"
                helper="Your best guess. Choose Audited once you have read the label."
                error={errors.installYear}
              >
                {(control) => (
                  <Input
                    {...control}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="2014"
                    value={fields.installYear}
                    onChange={(event) =>
                      set({ installYear: event.target.value })
                    }
                    className="font-mono tabular-nums"
                  />
                )}
              </Field>
            ) : (
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
                    onChange={(event) =>
                      set({ installedOn: event.target.value })
                    }
                    className="font-mono tabular-nums"
                  />
                )}
              </Field>
            )}
            <Field
              name={name("cost")}
              label="What it cost"
              optional
              helper="The price paid when it was installed — the basis."
              error={errors.cost}
            >
              {(control) => (
                <MoneyInput
                  {...control}
                  value={fields.cost}
                  onChange={(event) => set({ cost: event.target.value })}
                />
              )}
            </Field>
          </TwoUp>

          <TwoUp>
            <Field
              name={name("expectedLife")}
              label="Expected life, in years"
              error={errors.expectedLife}
            >
              {(control) => (
                <Input
                  {...control}
                  inputMode="numeric"
                  autoComplete="off"
                  value={fields.expectedLife}
                  onChange={(event) =>
                    set({ expectedLife: event.target.value })
                  }
                  className="font-mono tabular-nums"
                />
              )}
            </Field>
            <Field
              name={name("replacementCost")}
              label="Replacement cost"
              helper="What replacing it would cost today — the forecast’s figure."
              error={errors.replacementCost}
            >
              {(control) => (
                <MoneyInput
                  {...control}
                  value={fields.replacementCost}
                  onChange={(event) =>
                    set({ replacementCost: event.target.value })
                  }
                />
              )}
            </Field>
          </TwoUp>

          {showScope ? (
            <Field name={name("scope")} label="Scope" error={errors.scope}>
              {(control) => (
                <Select
                  value={fields.scope}
                  onValueChange={(scope) => set({ scope })}
                >
                  <SelectTrigger {...control} className="w-full sm:w-1/2">
                    <SelectValue>{scopeLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="shared">Shared</SelectItem>
                    {scopes.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          ) : null}

          <Field
            name={name("notes")}
            label="Notes"
            optional
            error={errors.notes}
          >
            {(control) => (
              <Textarea
                {...control}
                value={fields.notes}
                onChange={(event) => set({ notes: event.target.value })}
                rows={4}
                className="min-h-24"
              />
            )}
          </Field>
        </fieldset>
      </form>
    </Modal>
  );
}

/** Two fields side by side from `sm`, stacked below it. */
function TwoUp({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-5 sm:grid-cols-2">{children}</div>;
}
