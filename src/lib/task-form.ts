/**
 * A task's forms, once, for both sides of each: the building page's inline add
 * row (`docs/ui/screens/building-detail.md`), which adds a recurring task first
 * due one interval from today, and the task modal
 * (`docs/ui/screens/modal-task-detail.md`) — its form, and `Mark done`'s short
 * one. The browser runs the validator before it sends anything and the server
 * action runs it again — `building-form.ts` explains why one function serves
 * both.
 *
 * Framework-free. It knows the shape of a trade's slug and of an id, not which
 * trades, contacts or items exist: those are the action's to refuse.
 */
import { z } from "zod";

import { moneyField } from "@/lib/building-form";
import { type CalendarDate, isCalendarDate, yearOf } from "@/lib/dates";
import { amount, type FieldErrors, UNREADABLE_FORM } from "@/lib/forms";
import type { Cents } from "@/lib/money";
import {
  type Frequency,
  isFrequency,
  PRIORITY_LABELS,
  type Priority,
} from "@/lib/tasks";

/** The row, as typed and chosen. */
export type NewTaskFields = {
  title: string;
  /** A building's id — the page's own. */
  buildingId: string;
  /** `shared`, or a unit of that building. */
  scope: string;
  /** Months, as the frequency `Select` holds it; empty for a one-off. */
  recurrence: string;
};

export type NewTaskValues = {
  title: string;
  buildingId: string;
  /** Null for the building's own. Still to be found in the building. */
  unitId: string | null;
  recurrenceMonths: Frequency | null;
};

export type ValidatedNewTask =
  { ok: true; values: NewTaskValues } | { ok: false; errors: FieldErrors };

/** Long enough for any job's name; a paragraph belongs in the notes. */
export const TITLE_MAX = 200;

const shape = z.object({
  title: z.string().max(5000),
  buildingId: z.string().max(100),
  scope: z.string().max(100),
  recurrence: z.string().max(10),
});

const uuid = z.uuid();

/** Both forms' title rule, on a title already trimmed. */
function titleError(title: string): string | null {
  if (title === "") return "Enter what needs doing.";
  if (title.length > TITLE_MAX) {
    return `Keep it to ${TITLE_MAX} characters — put the rest in the task’s notes.`;
  }
  return null;
}

export function validateNewTask(input: unknown): ValidatedNewTask {
  const parsed = shape.safeParse(input);
  if (!parsed.success) return { ok: false, errors: { form: UNREADABLE_FORM } };

  const fields = parsed.data;
  const errors: FieldErrors = {};

  const title = fields.title.trim();
  const titleMessage = titleError(title);
  if (titleMessage) errors.title = titleMessage;

  if (fields.buildingId === "") {
    errors.buildingId = "Choose the building it’s for.";
  } else if (!uuid.safeParse(fields.buildingId).success) {
    return { ok: false, errors: { form: UNREADABLE_FORM } };
  }

  const shared = fields.scope === "shared";
  if (!shared && !uuid.safeParse(fields.scope).success) {
    return { ok: false, errors: { form: UNREADABLE_FORM } };
  }

  let recurrenceMonths: Frequency | null = null;
  if (fields.recurrence !== "") {
    const months = Number(fields.recurrence);
    if (!isFrequency(months)) {
      return { ok: false, errors: { form: UNREADABLE_FORM } };
    }
    recurrenceMonths = months;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    values: {
      title,
      buildingId: fields.buildingId,
      unitId: shared ? null : fields.scope,
      recurrenceMonths,
    },
  };
}

/**
 * What the task modal is editing: a task not yet added, an open one —
 * unscheduled or scheduled — or one already done. A done task has its
 * completion date and what it cost in place of a due date, a confirmation and
 * a repeat, which its completion has already acted on.
 */
export type TaskKind = "new" | "open" | "done";

type TaskKindWithToday =
  { kind: "new" | "open" } | { kind: "done"; today: CalendarDate };

/**
 * A `Select`'s value for "none of these". Radix refuses an empty string as an
 * item's value, and no id, slug or number of months can be this word.
 */
export const NONE = "none";

/** The assignee `Select`'s value for the viewer. */
export const ME = "me";

/**
 * Another member of the org, kept as it is. Offered only on a task already
 * assigned to one, until #30 can name members (`modal-task-detail.md`).
 */
export const MEMBER = "member";

/** The modal's form, as typed and chosen. */
export type TaskFields = {
  title: string;
  /** New tasks only: a building's id, and `shared` or one of its units. */
  buildingId: string;
  scope: string;
  notes: string;
  /** Open and new tasks. Empty keeps the task unscheduled. */
  dueDate: string;
  /** `none`, `me`, `member`, or a contact's id. */
  assignee: string;
  confirmed: boolean;
  priority: string;
  estCost: string;
  /** Open and new tasks: `none` for a one-off, or months. */
  recurrence: string;
  /** `none`, or a trade's slug. */
  trade: string;
  /** `none`, or one of the building's capital items. */
  equipment: string;
  /** Done tasks only. */
  completedOn: string;
  actualCost: string;
};

export type AssigneeValue =
  | { kind: "contact"; contactId: string }
  | { kind: "me" }
  | { kind: "member" }
  | null;

/**
 * The form, as the action writes it. A field the kind does not have is null,
 * and the action writes only the kind's own.
 */
export type TaskValues = {
  title: string;
  notes: string | null;
  priority: Priority;
  estCostCents: Cents | null;
  tradeTag: string | null;
  capitalItemId: string | null;
  assignee: AssigneeValue;
  confirmed: boolean;
  dueDate: CalendarDate | null;
  recurrenceMonths: Frequency | null;
  completedOn: CalendarDate | null;
  actualCostCents: Cents | null;
  /** New tasks only. */
  buildingId: string | null;
  unitId: string | null;
};

export type ValidatedTask =
  { ok: true; values: TaskValues } | { ok: false; errors: FieldErrors };

/** A job's notes run to a paragraph or two, not a manual. */
export const NOTES_MAX = 5000;

/**
 * Before this, a year is a typo: `<input type="date">` takes 0226 as readily
 * as 2026.
 */
const EARLIEST_TASK_YEAR = 1900;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const taskShape = z.object({
  title: z.string().max(10_000),
  buildingId: z.string().max(100),
  scope: z.string().max(100),
  notes: z.string().max(50_000),
  dueDate: z.string().max(100),
  assignee: z.string().max(100),
  confirmed: z.boolean(),
  priority: z.string().max(20),
  estCost: z.string().max(500),
  recurrence: z.string().max(10),
  trade: z.string().max(100).regex(SLUG),
  equipment: z.string().max(100),
  completedOn: z.string().max(100),
  actualCost: z.string().max(500),
});

type DateField =
  | { state: "empty" }
  | { state: "ok"; date: CalendarDate }
  | { state: "bad"; message: string };

/** A date field as typed: nothing, a date, or the message to show. */
function dateField(raw: string): DateField {
  const date = raw.trim();
  if (date === "") return { state: "empty" };
  if (!isCalendarDate(date)) {
    return {
      state: "bad",
      message: "Enter the whole date — day, month and year.",
    };
  }
  if (yearOf(date) < EARLIEST_TASK_YEAR) {
    return {
      state: "bad",
      message: `Enter a date in ${EARLIEST_TASK_YEAR} or later.`,
    };
  }
  return { state: "ok", date };
}

/**
 * The day a task was done: required, and not after today where the building
 * is — work not done yet has a due date, not a completion.
 */
function completedOnError(
  field: DateField,
  today: CalendarDate,
): string | null {
  if (field.state === "empty") return "Enter the day it was done.";
  if (field.state === "bad") return field.message;
  if (field.date > today) return "Enter today’s date or an earlier one.";
  return null;
}

/**
 * The task modal's form (`modal-task-detail.md`, the form).
 *
 * - **The title is required**, as the add row's is.
 * - **The date is optional**, and whether there is one decides the status: the
 *   action schedules a task with one and unschedules a task without.
 * - **A done task says when it was done**, today or earlier.
 * - **An empty amount is no amount**, not zero.
 *
 * A done task comes with today where its building is, which judges its
 * completion date. Nothing else is judged against today: a due date may be any
 * day, since an overdue job is still worth writing down.
 */
export function validateTask(
  input: unknown,
  kind: TaskKindWithToday,
): ValidatedTask {
  const parsed = taskShape.safeParse(input);
  if (!parsed.success) return { ok: false, errors: { form: UNREADABLE_FORM } };

  const fields = parsed.data;
  const errors: FieldErrors = {};

  const title = fields.title.trim();
  const titleMessage = titleError(title);
  if (titleMessage) errors.title = titleMessage;

  let buildingId: string | null = null;
  let unitId: string | null = null;
  if (kind.kind === "new") {
    if (fields.buildingId === "") {
      errors.buildingId = "Choose the building it’s for.";
    } else if (!uuid.safeParse(fields.buildingId).success) {
      return { ok: false, errors: { form: UNREADABLE_FORM } };
    } else {
      buildingId = fields.buildingId;
    }

    if (fields.scope !== "shared") {
      if (!uuid.safeParse(fields.scope).success) {
        return { ok: false, errors: { form: UNREADABLE_FORM } };
      }
      unitId = fields.scope;
    }
  }

  const notes = fields.notes.trim();
  if (notes.length > NOTES_MAX) {
    errors.notes = `Keep the notes to ${NOTES_MAX.toLocaleString("en-US")} characters.`;
  }

  let dueDate: CalendarDate | null = null;
  let recurrenceMonths: Frequency | null = null;
  let completedOn: CalendarDate | null = null;
  let actualCostCents: Cents | null = null;

  if (kind.kind === "done") {
    const done = dateField(fields.completedOn);
    const message = completedOnError(done, kind.today);
    if (message) errors.completedOn = message;
    else if (done.state === "ok") completedOn = done.date;

    const cost = amount(fields.actualCost);
    if (cost.state === "bad") errors.actualCost = cost.message;
    else if (cost.state === "ok") actualCostCents = cost.cents;
  } else {
    const due = dateField(fields.dueDate);
    if (due.state === "bad") errors.dueDate = due.message;
    else if (due.state === "ok") dueDate = due.date;

    if (fields.recurrence !== NONE) {
      const months = Number(fields.recurrence);
      if (!isFrequency(months)) {
        return { ok: false, errors: { form: UNREADABLE_FORM } };
      }
      recurrenceMonths = months;
    }
  }

  let assignee: AssigneeValue = null;
  if (fields.assignee === ME) {
    assignee = { kind: "me" };
  } else if (fields.assignee === MEMBER) {
    assignee = { kind: "member" };
  } else if (fields.assignee !== NONE) {
    if (!uuid.safeParse(fields.assignee).success) {
      return { ok: false, errors: { form: UNREADABLE_FORM } };
    }
    assignee = { kind: "contact", contactId: fields.assignee };
  }

  if (!Object.hasOwn(PRIORITY_LABELS, fields.priority)) {
    return { ok: false, errors: { form: UNREADABLE_FORM } };
  }

  if (fields.equipment !== NONE && !uuid.safeParse(fields.equipment).success) {
    return { ok: false, errors: { form: UNREADABLE_FORM } };
  }

  const estimate = amount(fields.estCost);
  if (estimate.state === "bad") errors.estCost = estimate.message;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    values: {
      title,
      notes: notes === "" ? null : notes,
      priority: fields.priority as Priority,
      estCostCents: estimate.state === "ok" ? estimate.cents : null,
      tradeTag: fields.trade === NONE ? null : fields.trade,
      capitalItemId: fields.equipment === NONE ? null : fields.equipment,
      assignee,
      confirmed: fields.confirmed,
      dueDate,
      recurrenceMonths,
      completedOn,
      actualCostCents,
      buildingId,
      unitId,
    },
  };
}

/** A booking, as `confirmationOn` compares two: the day, and who. */
export type Booking = {
  dueDate: CalendarDate | null;
  /** The assignee `Select`'s value. */
  assignee: string;
};

/**
 * **When a saved task counts as confirmed** (#93, `modal-task-detail.md`).
 *
 * - Only a task booked with somebody for a day — a date and an assignee — can
 *   be. Anything else saves unconfirmed, and so does an unticked box.
 * - Ticked, it keeps the day it was confirmed while the booking is the one
 *   that was confirmed, and records today for a new one. A new date or a new
 *   assignee is a new booking, and ticking the box in the same save confirms
 *   that booking.
 *
 * The modal unticks the box as the date or the assignee changes, so a new
 * booking is confirmed only by ticking it again; and the database clears a
 * confirmation that a change of booking left as it was
 * (`tasks_clear_confirmation`).
 */
export function confirmationOn(
  before: (Booking & { confirmedOn: CalendarDate | null }) | null,
  after: Booking & { confirmed: boolean },
  today: CalendarDate,
): CalendarDate | null {
  if (!after.confirmed || after.dueDate === null || after.assignee === NONE) {
    return null;
  }

  if (before?.confirmedOn && sameBooking(before, after)) {
    return before.confirmedOn;
  }

  return today;
}

export function sameBooking(a: Booking, b: Booking): boolean {
  return a.dueDate === b.dueDate && a.assignee === b.assignee;
}

/** A stored assignee, as the assignee `Select` holds it. */
export function assigneeField(task: {
  assigneeContactId: string | null;
  assigneeKind: "contact" | "me" | "member" | null;
}): string {
  if (task.assigneeKind === null) return NONE;
  if (task.assigneeKind === "contact") return task.assigneeContactId ?? NONE;
  return task.assigneeKind === "me" ? ME : MEMBER;
}

/** A stored task, as `taskFields` reads it. */
export type StoredTask = {
  title: string;
  unitId: string | null;
  notes: string | null;
  dueDate: CalendarDate | null;
  completedOn: CalendarDate | null;
  confirmedOn: CalendarDate | null;
  assigneeContactId: string | null;
  assigneeKind: "contact" | "me" | "member" | null;
  priority: Priority;
  estCostCents: Cents | null;
  actualCostCents: Cents | null;
  recurrenceMonths: number | null;
  tradeTag: string | null;
  capitalItemId: string | null;
};

/**
 * A stored task as the form holds it, so saving an untouched form writes back
 * what it read — amounts to the cent, for the reason `moneyField` gives.
 */
export function taskFields(task: StoredTask, buildingId: string): TaskFields {
  return {
    title: task.title,
    buildingId,
    scope: task.unitId ?? "shared",
    notes: task.notes ?? "",
    dueDate: task.dueDate ?? "",
    assignee: assigneeField(task),
    confirmed: task.confirmedOn !== null,
    priority: task.priority,
    estCost: moneyField(task.estCostCents),
    recurrence:
      task.recurrenceMonths === null ? NONE : String(task.recurrenceMonths),
    trade: task.tradeTag ?? NONE,
    equipment: task.capitalItemId ?? NONE,
    completedOn: task.completedOn ?? "",
    actualCost: moneyField(task.actualCostCents),
  };
}

/** `?task=new`: nothing typed, on the page's building when it has one. */
export function emptyTaskFields(buildingId: string | null): TaskFields {
  return {
    title: "",
    buildingId: buildingId ?? "",
    scope: "shared",
    notes: "",
    dueDate: "",
    assignee: NONE,
    confirmed: false,
    priority: "normal",
    estCost: "",
    recurrence: NONE,
    trade: NONE,
    equipment: NONE,
    completedOn: "",
    actualCost: "",
  };
}

/**
 * `Mark done`'s short form, as typed. `recordExpense` is its `Record as an
 * expense` box (#142); absent is unticked.
 */
export type CompletionFields = {
  completedOn: string;
  cost: string;
  recordExpense?: boolean;
};

export type ValidatedCompletion =
  | {
      ok: true;
      values: {
        completedOn: CalendarDate;
        actualCostCents: Cents | null;
        /** Ticked, and a cost above zero to record. */
        recordExpense: boolean;
      };
    }
  | { ok: false; errors: FieldErrors };

const completionShape = z.object({
  completedOn: z.string().max(100),
  cost: z.string().max(500),
  recordExpense: z.boolean().optional(),
});

/**
 * `Mark done` (`modal-task-detail.md`, footer): the day it was done — today by
 * default, and no later — and what it cost, the estimate by default. An empty
 * cost records none, rather than zero. **An expense is recorded only for a
 * cost above zero**, whatever the box says: no cost, or a free job, is no
 * money out.
 */
export function validateCompletion(
  input: unknown,
  today: CalendarDate,
): ValidatedCompletion {
  const parsed = completionShape.safeParse(input);
  if (!parsed.success) return { ok: false, errors: { form: UNREADABLE_FORM } };

  const errors: FieldErrors = {};

  const done = dateField(parsed.data.completedOn);
  const message = completedOnError(done, today);
  if (message) errors.completedOn = message;

  const cost = amount(parsed.data.cost);
  if (cost.state === "bad") errors.cost = cost.message;

  if (message || cost.state === "bad" || done.state !== "ok") {
    return { ok: false, errors };
  }

  return {
    ok: true,
    values: {
      completedOn: done.date,
      actualCostCents: cost.state === "ok" ? cost.cents : null,
      recordExpense:
        parsed.data.recordExpense === true &&
        cost.state === "ok" &&
        cost.cents > 0,
    },
  };
}
