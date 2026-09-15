"use client";

import { CheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { toast } from "sonner";

import { Field, MoneyInput } from "@/components/field";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { type CalendarDate, formatDate } from "@/lib/dates";
import type { FieldErrors } from "@/lib/forms";
import type { Cents } from "@/lib/money";
import {
  newRentPeriodFields,
  type RentPeriodFields,
  rentPeriodFields,
  validateRentPeriod,
} from "@/lib/rent-period-form";
import {
  markRentPaid,
  openRentPeriod,
  saveRentPeriod,
  unmarkRentPaid,
} from "@/server/actions/rent-periods";
import type { RentPeriodRecord } from "@/server/queries/rent-periods";

/**
 * The rent roll's controls (`docs/ui/screens/building-detail.md`, Units &
 * rent): the Paid toggle and `Other amount` beside it on a month with rent
 * expected, and `Record rent` on a month without — a vacant month, or a unit
 * with no period at all (#97).
 *
 * **Nothing here computes a figure.** Every write is a server action, and the
 * row re-renders from the server's answer: the page is refreshed after each
 * one, and a failed write leaves the control as it was with a line under it
 * (`screens/README.md`, errors).
 *
 * `Mark paid` and `Other amount` are 44px tall below `md` — rent is marked on
 * a phone as often as not (`building-detail.md`, narrow viewports).
 */

/** What every control in a row needs to know about it. */
type RowContext = {
  unitId: string;
  unitLabel: string;
  /** The month on screen. */
  month: CalendarDate;
  /** Today where the building is — the latest a payment can be dated. */
  today: CalendarDate;
};

const TALL = "max-md:h-11 max-md:px-4 max-md:text-sm";

const SAVE_FAILED = "Couldn’t save. Try again.";

export function RentControls({
  context,
  period,
  rentCents,
}: {
  context: RowContext;
  /** The unit's period for the month, or null for a unit with none. */
  period: RentPeriodRecord | null;
  /** The unit's rent today, where `Record rent` starts from. */
  rentCents: Cents | null;
}) {
  if (period && !period.vacant) {
    return (
      <div className="flex flex-col items-end gap-1 md:flex-row md:items-center md:justify-end md:gap-2">
        <PaidToggle context={context} period={period} />
        <RentForm
          context={context}
          trigger="Other amount"
          initial={rentPeriodFields(period, context.today)}
          periodId={period.id}
          offerVacant
        />
      </div>
    );
  }

  return (
    <div className="flex justify-end">
      <RentForm
        context={context}
        trigger="Record rent"
        initial={
          period
            ? rentPeriodFields(period, context.today)
            : newRentPeriodFields(context.month, rentCents, context.today)
        }
        periodId={period?.id ?? null}
        offerVacant={period !== null}
      />
    </div>
  );
}

/**
 * `Mark paid`, one click, and `Paid` once it is — pressing it again un-marks.
 * A toggle, so its name stays put while `aria-pressed` says which it is, and
 * the name carries the unit and month because a list of buttons read out of
 * the table all say the same word.
 *
 * Both directions take effect at once and offer `Undo` for five seconds, the
 * shared rule for one-click writes. Un-marking's `Undo` puts back the row as
 * it was drawn, partial amount and date included.
 */
function PaidToggle({
  context,
  period,
}: {
  context: RowContext;
  period: RentPeriodRecord;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  const marked = period.amountReceivedCents !== null;
  const where = `${context.unitLabel}, ${formatDate(context.month, "month-long")}`;

  function undo(write: () => Promise<{ ok: boolean }>) {
    return () => {
      void write().then(
        (result) => {
          if (!result.ok) toast.error(`Couldn’t undo. ${where} is unchanged.`);
          router.refresh();
        },
        () => toast.error(`Couldn’t undo. ${where} is unchanged.`),
      );
    };
  }

  function toggle() {
    setFailed(false);
    // The row as it is drawn now, which is what un-marking's `Undo` restores.
    const before = rentPeriodFields(period, context.today);

    startTransition(async () => {
      const result = await (
        marked ? unmarkRentPaid(period.id) : markRentPaid(period.id)
      ).catch(() => ({ ok: false as const }));

      if (!result.ok) {
        setFailed(true);
        router.refresh();
        return;
      }

      router.refresh();
      toast(marked ? `${where}: un-marked.` : `${where}: marked paid.`, {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: marked
            ? undo(() => saveRentPeriod(period.id, before))
            : undo(() => unmarkRentPaid(period.id)),
        },
      });
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant={marked ? "secondary" : "outline"}
        aria-pressed={marked}
        aria-label={`Paid: ${where}`}
        disabled={pending}
        onClick={toggle}
        className={TALL}
      >
        {marked ? <CheckIcon aria-hidden /> : null}
        {marked ? "Paid" : "Mark paid"}
      </Button>
      {failed ? (
        <p
          role="alert"
          className="text-right text-2xs leading-snug text-status-danger"
        >
          {SAVE_FAILED}
        </p>
      ) : null}
    </div>
  );
}

/** `md`, where the popover stops being a modal (`screens/README.md`). */
const WIDE = "(min-width: 48rem)";

function subscribeToWidth(onChange: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);

  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the viewport is `md` or wider. The server has no viewport, and the
 * answer only matters once the form is opened, which only happens in the
 * browser — so its snapshot is a guess nobody sees.
 */
function useWide(): boolean {
  return useSyncExternalStore(
    subscribeToWidth,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

/**
 * The Other amount form, and `Record rent`'s: what arrived and when, the
 * amount expected — how a rent change entered after the month opened is
 * corrected — a note, and, on a month that exists, whether the unit stood
 * empty. A `Popover` beside the control from `md` up and a `Modal` below it,
 * per the shared rule for modals on a narrow screen.
 *
 * The buttons sit outside the form in both — the modal pins them in its
 * footer — and reach it through `form=`, so the save and its pending state
 * belong here rather than to the fields.
 */
function RentForm({
  context,
  trigger,
  initial,
  periodId,
  offerVacant,
}: {
  context: RowContext;
  trigger: "Other amount" | "Record rent";
  initial: RentPeriodFields;
  /** Null for a month the unit has no period for: saving opens one. */
  periodId: string | null;
  /** Whether the form offers `vacant` — only on a period that exists. */
  offerVacant: boolean;
}) {
  const router = useRouter();
  const wide = useWide();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const where = `${context.unitLabel}, ${formatDate(context.month, "month-long")}`;
  const formId = `rent-form-${context.unitId}`;

  function onOpenChange(next: boolean) {
    if (!pending) setOpen(next);
  }

  function save(
    fields: RentPeriodFields,
    onErrors: (errors: FieldErrors) => void,
  ) {
    startTransition(async () => {
      const result = await (
        periodId === null
          ? openRentPeriod(context.unitId, context.month, fields)
          : saveRentPeriod(periodId, fields)
      ).catch(() => null);

      if (result === null) {
        onErrors({ form: SAVE_FAILED });
        return;
      }

      if (!result.ok) {
        onErrors(result.errors);
        return;
      }

      setOpen(false);
      router.refresh();
      toast.success(`${where}: saved.`);
    });
  }

  const button = (
    <Button
      type="button"
      variant="link"
      size="xs"
      aria-label={`${trigger}: ${where}`}
      className={`px-0 text-accent ${TALL}`}
      onClick={wide ? undefined : () => setOpen(true)}
    >
      {trigger}
    </Button>
  );

  const fields = (
    <RentFormFields
      formId={formId}
      context={context}
      initial={initial}
      offerVacant={offerVacant}
      onSave={save}
    />
  );

  const cancel = (
    <Button
      type="button"
      variant="outline"
      size={wide ? "sm" : "default"}
      onClick={() => onOpenChange(false)}
    >
      Cancel
    </Button>
  );

  const submit = (
    <Button
      type="submit"
      form={formId}
      size={wide ? "sm" : "default"}
      disabled={pending}
    >
      {pending ? "Saving…" : "Save"}
    </Button>
  );

  if (!wide) {
    return (
      <>
        {button}
        {open ? (
          <Modal
            open
            onOpenChange={onOpenChange}
            title={`${context.unitLabel} · ${formatDate(context.month, "month-long")}`}
            width="480px"
            footer={
              <div className="flex flex-col-reverse gap-2">
                {cancel}
                {submit}
              </div>
            }
          >
            {fields}
          </Modal>
        ) : null}
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={`${trigger}: ${where}`}
        className="w-80 gap-4 p-4"
      >
        <p className="text-sm leading-tight font-semibold text-text-primary">
          {context.unitLabel} · {formatDate(context.month, "month-long")}
        </p>
        {fields}
        <div className="flex justify-end gap-2">
          {cancel}
          {submit}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The fields, as typed. Mounted when the form opens and gone when it closes,
 * so each opening starts from the row as the server last drew it.
 *
 * Received first, because a partial or late payment is what the form is
 * opened for most; vacant last, because it is the rare case, and first would
 * put the focus on it.
 */
function RentFormFields({
  formId,
  context,
  initial,
  offerVacant,
  onSave,
}: {
  formId: string;
  context: RowContext;
  initial: RentPeriodFields;
  offerVacant: boolean;
  onSave: (
    fields: RentPeriodFields,
    onErrors: (errors: FieldErrors) => void,
  ) => void;
}) {
  const [fields, setFields] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});

  const name = (field: string) => `rent-${context.unitId}-${field}`;

  function set<K extends keyof RentPeriodFields>(
    key: K,
    value: RentPeriodFields[K],
  ) {
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

    const checked = validateRentPeriod(fields, context.today);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }

    setErrors({});
    onSave(fields, setErrors);
  }

  return (
    <form
      id={formId}
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4"
    >
      {fields.vacant ? null : (
        <div className="grid grid-cols-2 gap-3">
          <Field
            name={name("received")}
            label="Received"
            error={errors.received}
          >
            {(control) => (
              <MoneyInput
                {...control}
                value={fields.received}
                onChange={(event) => set("received", event.target.value)}
                // Not the input's `$0`, which is the one amount this field
                // refuses: nothing arrived is an empty field.
                placeholder="Nothing yet"
              />
            )}
          </Field>
          <Field name={name("receivedOn")} label="On" error={errors.receivedOn}>
            {(control) => (
              <Input
                {...control}
                type="date"
                max={context.today}
                value={fields.receivedOn}
                onChange={(event) => set("receivedOn", event.target.value)}
                className="font-mono tabular-nums"
              />
            )}
          </Field>
        </div>
      )}

      <Field
        name={name("expected")}
        label="Expected"
        helper={
          fields.vacant
            ? undefined
            : "Correct it here if the rent changed after the month began."
        }
        error={errors.expected}
      >
        {(control) => (
          <MoneyInput
            {...control}
            value={fields.expected}
            onChange={(event) => set("expected", event.target.value)}
          />
        )}
      </Field>

      <Field name={name("note")} label="Note" optional error={errors.note}>
        {(control) => (
          <Input
            {...control}
            value={fields.note}
            onChange={(event) => set("note", event.target.value)}
            placeholder="e.g. rest promised on the 20th"
            autoComplete="off"
          />
        )}
      </Field>

      {offerVacant ? (
        <div className="flex items-start gap-2.5">
          <Checkbox
            id={name("vacant")}
            checked={fields.vacant}
            onCheckedChange={(checked) => set("vacant", checked === true)}
            aria-describedby={name("vacant-helper")}
            className="mt-0.5"
          />
          <div className="flex flex-col gap-1">
            <Label
              htmlFor={name("vacant")}
              className="text-sm leading-tight font-medium text-text-primary"
            >
              Vacant this month
            </Label>
            <p
              id={name("vacant-helper")}
              className="text-xs leading-snug text-text-muted"
            >
              No rent was owed, so the month is left out of the totals.
            </p>
          </div>
        </div>
      ) : null}

      {errors.form ? (
        <p role="alert" className="text-xs leading-snug text-status-danger">
          {errors.form}
        </p>
      ) : null}
    </form>
  );
}
