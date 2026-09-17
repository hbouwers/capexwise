"use client";

import { ChevronDownIcon } from "lucide-react";
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

import { TradeChip } from "@/components/contacts/trade-chip";
import { Field, MoneyInput } from "@/components/field";
import { FooterQuestion, Modal } from "@/components/modal";
import { ScopeLabel } from "@/components/scope-label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { moneyField } from "@/lib/building-form";
import { telHref } from "@/lib/contact-form";
import { contactsHref } from "@/lib/contacts";
import { type CalendarDate, formatDate, shortFormIn } from "@/lib/dates";
import type { FieldErrors } from "@/lib/forms";
import {
  type CompletionFields,
  emptyTaskFields,
  ME,
  MEMBER,
  NONE,
  sameBooking,
  type TaskFields,
  taskFields,
  type TaskKind,
  validateCompletion,
  validateTask,
} from "@/lib/task-form";
import { FREQUENCIES, frequencyLabel, PRIORITY_LABELS } from "@/lib/tasks";
import {
  cancelTask,
  completeTask,
  createTask,
  undoCompleteTask,
  updateTask,
} from "@/server/actions/tasks";
import type {
  TaskModal,
  TaskModalBuilding,
  TaskModalContact,
} from "@/server/queries/tasks";

/**
 * The task modal (`docs/ui/screens/modal-task-detail.md`), PRD F5: one modal
 * for every task — unscheduled, scheduled, recurring, done — and for adding
 * one. It lives in the URL, `?task={id}` or `?task=new`, on the contact
 * modal's pattern: the page reads the task on the server and mounts this with
 * it, and closing replaces the URL without the param.
 *
 * Two columns from 48rem of its own width — the form, and the contacts tagged
 * with the task's trade — and one below, the contacts after the form.
 *
 * **Closing a changed form asks first**, as the contact modal does: Escape,
 * the scrim, `×` and `Close` all come through `onOpenChange`. `Mark done` and
 * `Cancel task` replace the footer rather than opening a second dialog, and
 * say so when they would drop what was typed.
 *
 * A cancelled task, or one on an archived or sold building, opens read-only:
 * kept for its history, as every write refuses it.
 */

type OpenModal = Exclude<TaskModal, { kind: "not-found" }>;

/** What the footer is doing: the form's buttons, or one of these instead. */
type Asking = null | "discard" | "cancel" | "done";

const UNSAVED = "Your changes to this form won’t be saved.";

const SAVE_FAILED =
  "Couldn’t save the task. Check your connection and try again — what you typed is still here.";

/** The rail's own width, `grid-two-column`'s, from 48rem of the modal's. */
const BODY = "grid gap-7 @3xl:grid-cols-[minmax(0,1fr)_336px]";

export function TaskDetailModal({
  modal,
  today,
  closeHref,
}: {
  modal: OpenModal;
  /** Today where the task's building is. Unread for a new task. */
  today: CalendarDate;
  /** The page's URL without the modal. */
  closeHref: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const askedFrom = useRef<HTMLElement | null>(null);
  const [pending, startTransition] = useTransition();

  const task = modal.kind === "edit" ? modal.task : null;
  const kind: TaskKind =
    task === null ? "new" : task.status === "done" ? "done" : "open";
  const readOnly = modal.kind === "edit" && modal.readOnly;

  const [initial] = useState<TaskFields>(() =>
    modal.kind === "edit"
      ? taskFields(modal.task, modal.building.id)
      : emptyTaskFields(modal.buildingId),
  );
  const [open, setOpen] = useState(true);
  const [fields, setFields] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [asking, setAsking] = useState<Asking>(null);
  const [completion, setCompletion] = useState<CompletionFields>({
    completedOn: today,
    cost: moneyField(task?.actualCostCents ?? task?.estCostCents ?? null),
  });

  const changed = JSON.stringify(fields) !== JSON.stringify(initial);

  const buildings: TaskModalBuilding[] =
    modal.kind === "edit" ? [modal.building] : modal.buildings;
  const building = buildings.find((b) => b.id === fields.buildingId) ?? null;
  const multiUnit = (building?.units.length ?? 0) > 1;
  const tradeLabels = new Map(modal.trades.map((t) => [t.slug, t.label]));
  const trade = fields.trade === NONE ? null : fields.trade;

  function leave() {
    setOpen(false);
    router.replace(closeHref, { scroll: false });
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

  /** Back to the form, and focus back where it was — the contact modal's. */
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

  function set(next: Partial<TaskFields>) {
    setFields((current) => {
      const merged = { ...current, ...next };
      // A new day or a new assignee is a new booking, and is confirmed by
      // ticking the box again (`confirmationOn`).
      if (!sameBooking(current, merged) && !("confirmed" in next)) {
        merged.confirmed = false;
      }
      return merged;
    });
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

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending || readOnly) return;

    const checked = validateTask(
      fields,
      kind === "done" ? { kind, today } : { kind },
    );
    if (!checked.ok) {
      setErrors(checked.errors);
      focusFirstError();
      return;
    }

    setErrors({});
    startTransition(async () => {
      const result = await (
        task === null ? createTask(fields) : updateTask(task.id, fields)
      ).catch(() => null);

      if (result === null || !result.ok) {
        setErrors(result?.errors ?? { form: SAVE_FAILED });
        focusFirstError();
        return;
      }

      const { title, dueDate } = checked.values;
      toast.success(
        task !== null
          ? `${title}: saved.`
          : dueDate
            ? `${title}: added, due ${formatDate(dueDate)}.`
            : `${title}: added to Unscheduled.`,
      );
      leave();
    });
  }

  function markDone() {
    if (task === null) return;

    const checked = validateCompletion(completion, today);
    if (!checked.ok) {
      setErrors(checked.errors);
      focusFirstError();
      return;
    }

    setErrors({});
    startTransition(async () => {
      const result = await completeTask(task.id, completion).catch(() => null);

      if (!result?.ok) {
        setErrors(
          result?.errors ?? {
            form: "Couldn’t mark this done. Reload the page and try again.",
          },
        );
        focusFirstError();
        return;
      }

      const { title } = task;
      const undo = () => {
        void undoCompleteTask(task.id, result.previousActualCostCents).then(
          (undone) => {
            if (!undone.ok) {
              toast.error(
                result.next
                  ? `Couldn’t undo. ${title} is done, and its next one has changed since.`
                  : `Couldn’t undo. ${title} is still done.`,
              );
            }
            router.refresh();
          },
          () => toast.error(`Couldn’t undo. ${title} is still done.`),
        );
      };

      toast(
        result.next
          ? `${title}: done. Next due ${formatDate(result.next.dueDate)}.`
          : `${title}: done.`,
        { duration: 5000, action: { label: "Undo", onClick: undo } },
      );
      leave();
    });
  }

  function cancel() {
    if (task === null) return;

    startTransition(async () => {
      const result = await cancelTask(task.id).catch(() => ({ ok: false }));

      if (!result.ok) {
        setAsking(null);
        setErrors({
          form: "Couldn’t cancel the task. Reload the page and try again.",
        });
        focusFirstError();
        return;
      }

      toast.success(`${task.title}: cancelled.`);
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
  ) : asking === "cancel" && task !== null ? (
    <FooterQuestion
      question={`Cancel ${task.title}?`}
      detail={[
        "It stays in the history and leaves the task lists.",
        task.recurrenceMonths === null ? null : "It won’t come round again.",
        changed ? UNSAVED : null,
      ]
        .filter(Boolean)
        .join(" ")}
      keep="Keep task"
      confirm={pending ? "Cancelling…" : "Cancel task"}
      destructive
      disabled={pending}
      onKeep={keep}
      onConfirm={cancel}
    />
  ) : asking === "done" && task !== null ? (
    <div
      role="group"
      aria-label={`Mark ${task.title} done`}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Field
          name="completion.completedOn"
          label="Completed on"
          error={errors.completedOn}
          className="sm:w-44"
        >
          {(control) => (
            <Input
              {...control}
              type="date"
              max={today}
              value={completion.completedOn}
              onChange={(event) => {
                setCompletion((c) => ({
                  ...c,
                  completedOn: event.target.value,
                }));
                setErrors({});
              }}
              autoFocus
              className="font-mono tabular-nums"
            />
          )}
        </Field>
        <Field
          name="completion.cost"
          label="What it cost"
          optional
          error={errors.cost}
          className="sm:w-36"
        >
          {(control) => (
            <MoneyInput
              {...control}
              value={completion.cost}
              onChange={(event) => {
                setCompletion((c) => ({ ...c, cost: event.target.value }));
                setErrors({});
              }}
            />
          )}
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:mt-5.5 sm:ml-auto sm:flex-row">
          <Button type="button" variant="outline" onClick={keep}>
            Back
          </Button>
          <Button type="button" disabled={pending} onClick={markDone}>
            {pending ? "Saving…" : "Mark done"}
          </Button>
        </div>
      </div>
      {changed ? (
        <p className="text-xs leading-snug text-text-muted">{UNSAVED}</p>
      ) : null}
      {formError}
    </div>
  ) : (
    <div className="flex flex-col gap-3">
      {formError}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {kind === "open" ? (
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
                <DropdownMenuItem onSelect={() => ask("done")}>
                  Mark done
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => ask("cancel")}
                >
                  Cancel task
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
          <Button type="submit" form="task-form" disabled={pending}>
            {pending ? "Saving…" : task === null ? "Add task" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );

  const meta =
    modal.kind === "edit" ? (
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <span className="text-xs text-text-secondary">
          {modal.building.name}
        </span>
        {modal.building.units.length > 1 ? (
          <ScopeLabel>{modal.task.unitLabel ?? "Shared"}</ScopeLabel>
        ) : null}
        {modal.task.tradeLabel ? (
          <TradeChip label={modal.task.tradeLabel} />
        ) : null}
        <span className="text-xs text-text-muted">
          added{" "}
          {formatDate(
            modal.task.addedOn,
            shortFormIn(modal.task.addedOn, today),
          )}
        </span>
      </div>
    ) : null;

  const description =
    modal.kind !== "edit" || !modal.readOnly
      ? undefined
      : modal.task.status === "canceled"
        ? "Cancelled — kept for its history."
        : `The building is ${modal.building.status} — its tasks are kept for their history.`;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={task === null ? "New task" : task.title}
      description={description}
      meta={meta}
      width="900px"
      footer={footer}
    >
      <div className="@container">
        <div className={BODY}>
          <form
            id="task-form"
            ref={formRef}
            onSubmit={onSubmit}
            noValidate
            aria-label={task === null ? "New task" : `Edit ${task.title}`}
          >
            <fieldset
              disabled={readOnly}
              className="flex min-w-0 flex-col gap-5"
            >
              <Field name="title" label="Title" error={errors.title}>
                {(control) => (
                  <Input
                    {...control}
                    value={fields.title}
                    onChange={(event) => set({ title: event.target.value })}
                    autoComplete="off"
                    autoFocus={task === null}
                  />
                )}
              </Field>

              {modal.kind === "new" ? (
                <TwoUp>
                  <Field
                    name="buildingId"
                    label="Building"
                    error={errors.buildingId}
                  >
                    {(control) => (
                      <Select
                        value={fields.buildingId}
                        // A unit and an item belong to one building, so
                        // choosing another starts both over.
                        onValueChange={(next) =>
                          set({
                            buildingId: next,
                            scope: "shared",
                            equipment: NONE,
                          })
                        }
                      >
                        <SelectTrigger {...control} className="w-full">
                          <SelectValue placeholder="Choose a building">
                            {building?.name}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent position="popper">
                          {modal.buildings.map((option) => (
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
                          onValueChange={(next) => set({ scope: next })}
                        >
                          <SelectTrigger {...control} className="w-full">
                            <SelectValue>
                              {building.units.find(
                                (unit) => unit.id === fields.scope,
                              )?.label ?? "Shared"}
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
              ) : null}

              <Field name="notes" label="Notes" optional error={errors.notes}>
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

              <TwoUp>
                {kind === "done" ? (
                  <Field
                    name="completedOn"
                    label="Completed on"
                    error={errors.completedOn}
                  >
                    {(control) => (
                      <Input
                        {...control}
                        type="date"
                        max={today}
                        value={fields.completedOn}
                        onChange={(event) =>
                          set({ completedOn: event.target.value })
                        }
                        className="font-mono tabular-nums"
                      />
                    )}
                  </Field>
                ) : (
                  <Field
                    name="dueDate"
                    label="Date"
                    optional
                    helper="Leave empty to keep it unscheduled."
                    error={errors.dueDate}
                  >
                    {(control) => (
                      <Input
                        {...control}
                        type="date"
                        value={fields.dueDate}
                        onChange={(event) =>
                          set({ dueDate: event.target.value })
                        }
                        className="font-mono tabular-nums"
                      />
                    )}
                  </Field>
                )}
                <Field name="assignee" label="Assignee">
                  {(control) => (
                    <AssigneeSelect
                      control={control}
                      value={fields.assignee}
                      onChange={(assignee) => set({ assignee })}
                      contacts={modal.contacts}
                      trade={trade}
                      tradeLabel={trade ? tradeLabels.get(trade) : undefined}
                      keepsMember={initial.assignee === MEMBER}
                      kept={initial.assignee}
                    />
                  )}
                </Field>
              </TwoUp>

              {kind !== "done" &&
              fields.dueDate !== "" &&
              fields.assignee !== NONE ? (
                <Confirmation
                  checked={fields.confirmed}
                  onChange={(confirmed) => set({ confirmed })}
                  label={confirmationLabel(fields.assignee, modal.contacts)}
                  helper={
                    fields.confirmed &&
                    task?.confirmedOn &&
                    sameBooking(fields, initial)
                      ? `Confirmed ${formatDate(task.confirmedOn, shortFormIn(task.confirmedOn, today))}.`
                      : undefined
                  }
                />
              ) : null}

              <TwoUp>
                <Field name="priority" label="Priority">
                  {(control) => (
                    <Select
                      value={fields.priority}
                      onValueChange={(priority) => set({ priority })}
                    >
                      <SelectTrigger {...control} className="w-full">
                        <SelectValue>
                          {
                            PRIORITY_LABELS[
                              fields.priority as keyof typeof PRIORITY_LABELS
                            ]
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {(["high", "normal", "low"] as const).map((value) => (
                          <SelectItem key={value} value={value}>
                            {PRIORITY_LABELS[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
                <Field
                  name="estCost"
                  label="Estimated cost"
                  optional
                  error={errors.estCost}
                >
                  {(control) => (
                    <MoneyInput
                      {...control}
                      value={fields.estCost}
                      onChange={(event) => set({ estCost: event.target.value })}
                    />
                  )}
                </Field>
              </TwoUp>

              <TwoUp>
                {kind === "done" ? (
                  <Field
                    name="actualCost"
                    label="What it cost"
                    optional
                    error={errors.actualCost}
                  >
                    {(control) => (
                      <MoneyInput
                        {...control}
                        value={fields.actualCost}
                        onChange={(event) =>
                          set({ actualCost: event.target.value })
                        }
                      />
                    )}
                  </Field>
                ) : (
                  <Field name="recurrence" label="Repeats">
                    {(control) => (
                      <Select
                        value={fields.recurrence}
                        onValueChange={(recurrence) => set({ recurrence })}
                      >
                        <SelectTrigger {...control} className="w-full">
                          <SelectValue>
                            {frequencyLabel(
                              fields.recurrence === NONE
                                ? null
                                : Number(fields.recurrence),
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent position="popper">
                          <SelectItem value={NONE}>Once</SelectItem>
                          {FREQUENCIES.map((months) => (
                            <SelectItem key={months} value={String(months)}>
                              {frequencyLabel(months)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </Field>
                )}
                <Field name="trade" label="Trade">
                  {(control) => (
                    <Select
                      value={fields.trade}
                      onValueChange={(next) => set({ trade: next })}
                    >
                      <SelectTrigger {...control} className="w-full">
                        <SelectValue>
                          {trade ? tradeLabels.get(trade) : "None"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value={NONE}>None</SelectItem>
                        {modal.trades.map((option) => (
                          <SelectItem key={option.slug} value={option.slug}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
              </TwoUp>

              <Field
                name="equipment"
                label="Equipment"
                optional
                helper={
                  building && building.equipment.length === 0
                    ? "Nothing tracked on this building yet."
                    : undefined
                }
              >
                {(control) => (
                  <Select
                    value={fields.equipment}
                    onValueChange={(equipment) => set({ equipment })}
                    disabled={!building || building.equipment.length === 0}
                  >
                    <SelectTrigger {...control} className="w-full">
                      <SelectValue>
                        {equipmentLabel(building, fields.equipment)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value={NONE}>None</SelectItem>
                      {building?.equipment.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {equipmentLabel(building, item.id)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            </fieldset>
          </form>

          <RelevantContacts
            contacts={modal.contacts}
            trade={trade}
            tradeLabel={trade ? (tradeLabels.get(trade) ?? trade) : null}
            assignee={fields.assignee}
            onAssign={readOnly ? null : (assignee) => set({ assignee })}
          />
        </div>
      </div>
    </Modal>
  );
}

/** Two fields side by side from `sm`, and one column below it. */
function TwoUp({ children }: { children: ReactNode }) {
  return <div className="grid gap-5 sm:grid-cols-2 sm:gap-3">{children}</div>;
}

function contactOption(contact: TaskModalContact): string {
  return contact.archived ? `${contact.name} (archived)` : contact.name;
}

/**
 * `Unassigned`, `Me`, then contacts with the task's trade, then `Other
 * contacts` (`modal-task-detail.md`). `A member` only on a task that already
 * has one. An archived contact is offered only to the task already assigned to
 * them.
 */
function AssigneeSelect({
  control,
  value,
  onChange,
  contacts,
  trade,
  tradeLabel,
  keepsMember,
  kept,
}: {
  control: Parameters<Parameters<typeof Field>[0]["children"]>[0];
  value: string;
  onChange: (value: string) => void;
  contacts: TaskModalContact[];
  trade: string | null;
  tradeLabel: string | undefined;
  keepsMember: boolean;
  /** The assignee the task opened with. */
  kept: string;
}) {
  const offered = contacts.filter(
    (contact) => !contact.archived || contact.id === kept,
  );
  const tagged = trade
    ? offered.filter((contact) => contact.trades.includes(trade))
    : [];
  const others = offered.filter((contact) => !tagged.includes(contact));

  const selected =
    value === NONE
      ? "Unassigned"
      : value === ME
        ? "Me"
        : value === MEMBER
          ? "A member"
          : (() => {
              const contact = offered.find((c) => c.id === value);
              return contact ? contactOption(contact) : "Unassigned";
            })();

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger {...control} className="w-full">
        <SelectValue>{selected}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectItem value={NONE}>Unassigned</SelectItem>
        <SelectItem value={ME}>Me</SelectItem>
        {keepsMember ? <SelectItem value={MEMBER}>A member</SelectItem> : null}
        {tagged.length > 0 ? (
          <SelectGroup>
            <SelectLabel>Tagged {tradeLabel}</SelectLabel>
            {tagged.map((contact) => (
              <SelectItem key={contact.id} value={contact.id}>
                {contactOption(contact)}
              </SelectItem>
            ))}
          </SelectGroup>
        ) : null}
        {others.length > 0 ? (
          <SelectGroup>
            <SelectLabel>
              {tagged.length > 0 ? "Other contacts" : "Contacts"}
            </SelectLabel>
            {others.map((contact) => (
              <SelectItem key={contact.id} value={contact.id}>
                {contactOption(contact)}
              </SelectItem>
            ))}
          </SelectGroup>
        ) : null}
      </SelectContent>
    </Select>
  );
}

function confirmationLabel(
  assignee: string,
  contacts: TaskModalContact[],
): string {
  const contact = contacts.find((c) => c.id === assignee);
  return contact ? `Confirmed with ${contact.name}` : "Confirmed";
}

/** #93's checkbox, on a task booked with somebody for a day. */
function Confirmation({
  checked,
  onChange,
  label,
  helper,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  helper: string | undefined;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox
        id="field-confirmed"
        checked={checked}
        onCheckedChange={(next) => onChange(next === true)}
        aria-describedby={helper ? "field-confirmed-helper" : undefined}
        className="mt-0.5"
      />
      <div className="flex flex-col gap-1">
        <Label
          htmlFor="field-confirmed"
          className="text-sm leading-tight font-normal text-text-primary"
        >
          {label}
        </Label>
        {helper ? (
          <p
            id="field-confirmed-helper"
            className="text-xs leading-snug text-text-muted"
          >
            {helper}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * An item as the Equipment `Select` names it: its label, its unit on a
 * building with more than one, and whether it is still in service.
 */
function equipmentLabel(
  building: TaskModalBuilding | null,
  itemId: string,
): string {
  if (itemId === NONE || building === null) return "None";
  const item = building.equipment.find((i) => i.id === itemId);
  if (!item) return "None";

  const unit =
    building.units.length > 1
      ? (building.units.find((u) => u.id === item.unitId)?.label ?? "Shared")
      : null;

  return [item.label, unit, item.inService ? null : "no longer in service"]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The rail (`modal-task-detail.md`, relevant contacts): the contacts tagged
 * with the form's trade as it stands, each with its rate note. `Assign` sets
 * the Assignee field, and nothing saves until the form does.
 *
 * **Company and phone sit under the name**, not in columns of their own: the
 * rail is 336px at its widest, and four columns in it left a name two
 * characters wide.
 */
function RelevantContacts({
  contacts,
  trade,
  tradeLabel,
  assignee,
  onAssign,
}: {
  contacts: TaskModalContact[];
  trade: string | null;
  tradeLabel: string | null;
  assignee: string;
  /** Null when the task is read-only. */
  onAssign: ((contactId: string) => void) | null;
}) {
  const tagged = trade
    ? contacts.filter(
        (contact) => !contact.archived && contact.trades.includes(trade),
      )
    : [];

  return (
    <section
      aria-labelledby="relevant-contacts-heading"
      className="flex min-w-0 flex-col self-start overflow-hidden rounded-lg border border-border-card"
    >
      <div className="flex flex-col gap-1 border-b border-border-divider px-4 py-3">
        <h3
          id="relevant-contacts-heading"
          className="text-sm leading-tight font-semibold text-text-primary"
        >
          Relevant contacts
        </h3>
        {trade ? (
          <p className="text-xs leading-snug text-text-muted">
            {tagged.length} tagged {tradeLabel}
          </p>
        ) : null}
      </div>

      {trade === null ? (
        <p className="px-4 py-4 text-sm text-text-tertiary">
          Set a trade to see matching contacts.
        </p>
      ) : tagged.length === 0 ? (
        <div className="flex flex-col items-start gap-2 px-4 py-4">
          <p className="text-sm text-text-tertiary">
            No contacts tagged {tradeLabel}.
          </p>
          <Link
            href={contactsHref({ trade, archived: false, contact: "new" })}
            className="text-sm text-accent underline-offset-4 hover:underline"
          >
            Add a contact
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border-divider">
          {tagged.map((contact) => {
            const tel = contact.phone ? telHref(contact.phone) : null;
            const assigned = assignee === contact.id;

            return (
              <li
                key={contact.id}
                className="flex items-start justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium text-text-primary">
                    {contact.name}
                  </span>
                  {contact.rateNote ? (
                    <span className="text-xs leading-snug text-text-secondary">
                      {contact.rateNote}
                    </span>
                  ) : null}
                  {contact.company ? (
                    <span className="text-xs leading-snug text-text-muted">
                      {contact.company}
                    </span>
                  ) : null}
                  {contact.phone ? (
                    tel ? (
                      <a
                        href={tel}
                        className="self-start font-mono text-xs text-accent tabular-nums underline-offset-4 hover:underline"
                      >
                        {contact.phone}
                      </a>
                    ) : (
                      <span className="font-mono text-xs text-text-muted tabular-nums">
                        {contact.phone}
                      </span>
                    )
                  ) : null}
                </div>
                {onAssign ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={assigned}
                    onClick={() => onAssign(contact.id)}
                    aria-label={
                      assigned
                        ? `${contact.name} is assigned`
                        : `Assign ${contact.name}`
                    }
                  >
                    {assigned ? "Assigned" : "Assign"}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
