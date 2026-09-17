"use server";

/**
 * The tasks' writes: the one-click ones (`docs/ui/screens/maintenance.md`,
 * `building-detail.md`) — the inline add row, checking a task done and taking
 * it back, and the Scheduled tab's confirmation toggle — and the task modal's
 * (`modal-task-detail.md`): adding a task, saving one, `Mark done` and `Cancel
 * task`. Each starts with `getOrgContext()`, so the org is the session's, and
 * every id the browser sends — a building, a unit, a task, a contact, an item
 * — is looked up inside that org rather than trusted.
 *
 * **Only an active building's tasks are written to.** An archived or sold
 * building is kept for its history and shown without controls, and these
 * refuse it the same way they refuse a task that is not there.
 *
 * "Today" is today where the building is (ADR-0005), read inside the write,
 * because it is the day a completion or a confirmation records.
 */

import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import {
  buildings,
  capitalItems,
  contacts,
  tasks,
  tradeTags,
  units,
} from "@/db/schema";
import { type CalendarDate, isCalendarDate, todayIn } from "@/lib/dates";
import { type FieldErrors } from "@/lib/forms";
import type { Cents } from "@/lib/money";
import {
  assigneeField,
  confirmationOn,
  type TaskValues,
  validateCompletion,
  validateNewTask,
  validateTask,
} from "@/lib/task-form";
import { firstDueDate, nextOccurrence } from "@/lib/tasks";
import { withoutParameters } from "@/lib/query-errors";
import { getOrgContext, type OrgScopedTx } from "@/server/org-context";

export type AddTaskResult =
  | { ok: true; taskId: string; dueDate: CalendarDate | null }
  | { ok: false; errors: FieldErrors };

/**
 * What a completion changed, so its Undo can put it back: the cost the task
 * had before the estimate was written in, and the occurrence it wrote.
 */
export type CompleteTaskResult =
  | {
      ok: true;
      previousActualCostCents: Cents | null;
      next: { id: string; dueDate: CalendarDate } | null;
    }
  | { ok: false; errors?: FieldErrors };

export type TaskWriteResult = { ok: true } | { ok: false };

export type ConfirmTaskResult =
  { ok: true; confirmedOn: CalendarDate | null } | { ok: false };

/**
 * A building archived, or a unit retired, between the page drawing and the
 * add — the row is out of date in both cases, and reloading is the fix.
 */
const BUILDING_NOT_FOUND =
  "The task could not be added. Reload the page — the building may have changed since you opened it.";

const idSchema = z.uuid();

function refused(message: string): { ok: false; errors: FieldErrors } {
  return { ok: false, errors: { form: message } };
}

/**
 * The building page's inline add row: a recurring task, **scheduled one
 * interval from today**, and the answer carries that date for the toast. Given
 * no interval it adds a one-off, **unscheduled**, waiting for a date. Either
 * may name a unit of the building that is not retired, or be the building's
 * own.
 *
 * Only on an active building. A failed write is re-thrown with its SQLSTATE
 * only: a title is free text, and may name a tenant.
 */
export async function addTask(input: unknown): Promise<AddTaskResult> {
  const { db } = await getOrgContext();

  const validated = validateNewTask(input);
  if (!validated.ok) return validated;

  const { values } = validated;

  try {
    return await db.run(async (tx): Promise<AddTaskResult> => {
      // `for share`: the building form takes this row `for update` before it
      // retires a unit, so it waits, and a task cannot land on a unit being
      // retired.
      const [building] = await tx
        .select({ id: buildings.id, timezone: buildings.timezone })
        .from(buildings)
        .where(
          and(
            eq(buildings.orgId, db.orgId),
            eq(buildings.id, values.buildingId),
            eq(buildings.status, "active"),
          ),
        )
        .for("share");

      if (!building) return refused(BUILDING_NOT_FOUND);

      if (values.unitId !== null) {
        const [unit] = await tx
          .select({ id: units.id })
          .from(units)
          .where(
            and(
              eq(units.orgId, db.orgId),
              eq(units.buildingId, building.id),
              eq(units.id, values.unitId),
              ne(units.status, "retired"),
            ),
          );

        if (!unit) return refused(BUILDING_NOT_FOUND);
      }

      const dueDate =
        values.recurrenceMonths === null
          ? null
          : firstDueDate(todayIn(building.timezone), values.recurrenceMonths);

      const [added] = await tx
        .insert(tasks)
        .values({
          orgId: db.orgId,
          buildingId: building.id,
          unitId: values.unitId,
          title: values.title,
          recurrenceMonths: values.recurrenceMonths,
          status: dueDate === null ? "unscheduled" : "scheduled",
          dueDate,
        })
        .returning({ id: tasks.id });

      if (!added) throw new Error("Inserting a task returned no row.");

      return { ok: true, taskId: added.id, dueDate };
    });
  } catch (error) {
    throw withoutParameters(error, "Adding a task");
  }
}

/**
 * The task and what the rules need of its building, locked for the length of
 * the write, so a completion and its Undo — or two clicks — cannot interleave.
 * `null` for a task that is not this org's, is cancelled, or whose building is
 * not active.
 */
async function lockTask(tx: OrgScopedTx, orgId: string, taskId: string) {
  const [row] = await tx
    .select({ task: tasks, timezone: buildings.timezone })
    .from(tasks)
    .innerJoin(
      buildings,
      and(eq(buildings.orgId, tasks.orgId), eq(buildings.id, tasks.buildingId)),
    )
    .where(
      and(
        eq(tasks.orgId, orgId),
        eq(tasks.id, taskId),
        ne(tasks.status, "canceled"),
        eq(buildings.status, "active"),
      ),
    )
    .for("update", { of: tasks });

  return row ?? null;
}

/**
 * The Done checkbox (`maintenance.md`, Scheduled; `building-detail.md`,
 * Recurring tasks): **done today, at its estimate** — today where the building
 * is, and the estimated cost as what it cost, unless a cost was recorded
 * already. A task that needs its real cost or date is completed from the task
 * modal, which asks for both (#114).
 *
 * A recurring task writes its next occurrence (`nextOccurrence`): the same
 * job, scope, equipment, assignee, estimate and interval, scheduled and not
 * yet confirmed, pointing back at this one. Only that one — never a year of
 * them (§6).
 *
 * **The task modal's `Mark done` says both** (`modal-task-detail.md`, footer):
 * `completion` is its short form — the day, today or earlier, and the cost,
 * where empty records none — and a form it cannot accept answers with the
 * message per field. The next occurrence is counted from that day.
 *
 * Only an open task. A second click, or one on a task somebody finished
 * meanwhile, is refused rather than repeated, so its Undo cannot reopen
 * somebody else's completion.
 */
export async function completeTask(
  taskId: unknown,
  completion?: unknown,
): Promise<CompleteTaskResult> {
  const { db } = await getOrgContext();

  const id = idSchema.safeParse(taskId);
  if (!id.success) return { ok: false };

  try {
    return await db.run(async (tx): Promise<CompleteTaskResult> => {
      const locked = await lockTask(tx, db.orgId, id.data);
      if (!locked || locked.task.status === "done") return { ok: false };

      const { task } = locked;
      const today = todayIn(locked.timezone);

      let completedOn = today;
      let actualCostCents = task.actualCostCents ?? task.estCostCents;
      if (completion !== undefined) {
        const checked = validateCompletion(completion, today);
        if (!checked.ok) return { ok: false, errors: checked.errors };
        ({ completedOn, actualCostCents } = checked.values);
      }

      await tx
        .update(tasks)
        .set({ status: "done", completedOn, actualCostCents })
        .where(and(eq(tasks.orgId, db.orgId), eq(tasks.id, task.id)));

      if (task.recurrenceMonths === null) {
        return {
          ok: true,
          previousActualCostCents: task.actualCostCents,
          next: null,
        };
      }

      const dueDate = nextOccurrence({
        dueDate: task.dueDate,
        completedOn,
        recurrenceMonths: task.recurrenceMonths,
      });

      const [next] = await tx
        .insert(tasks)
        .values({
          orgId: db.orgId,
          buildingId: task.buildingId,
          unitId: task.unitId,
          capitalItemId: task.capitalItemId,
          title: task.title,
          notes: task.notes,
          tradeTag: task.tradeTag,
          status: "scheduled",
          priority: task.priority,
          dueDate,
          assigneeContactId: task.assigneeContactId,
          assigneeUserId: task.assigneeUserId,
          estCostCents: task.estCostCents,
          recurrenceMonths: task.recurrenceMonths,
          recurrenceParentId: task.id,
        })
        .returning({ id: tasks.id });

      if (!next) throw new Error("Inserting a task returned no row.");

      return {
        ok: true,
        previousActualCostCents: task.actualCostCents,
        next: { id: next.id, dueDate },
      };
    });
  } catch (error) {
    throw withoutParameters(error, "Completing a task");
  }
}

const previousCostSchema = z
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .nullable();

/**
 * The completion toast's Undo: the task goes back to open — scheduled if it
 * has a date, unscheduled if not — with the cost it had before, and **the
 * occurrence the completion wrote is removed**.
 *
 * Only while that occurrence is untouched. Once somebody has confirmed it,
 * changed it, or completed it in turn, it is a task in its own right, and
 * reopening this one beside it would leave two of the same job open — so the
 * Undo is refused whole. `tasks_delete_as_materialised` in `0023` holds the
 * same rule, and the delete below is checked against it by the count it
 * returns rather than trusted.
 *
 * `previousActualCostCents` is what `completeTask` answered: the cost field as
 * it was, which the completion may have filled from the estimate.
 */
export async function undoCompleteTask(
  taskId: unknown,
  previousActualCostCents: unknown,
): Promise<TaskWriteResult> {
  const { db } = await getOrgContext();

  const id = idSchema.safeParse(taskId);
  const previous = previousCostSchema.safeParse(previousActualCostCents);
  if (!id.success || !previous.success) return { ok: false };

  try {
    return await db.run(async (tx): Promise<TaskWriteResult> => {
      const locked = await lockTask(tx, db.orgId, id.data);
      if (!locked || locked.task.status !== "done") return { ok: false };

      const { task } = locked;

      const children = await tx
        .select({
          id: tasks.id,
          createdAt: tasks.createdAt,
          updatedAt: tasks.updatedAt,
        })
        .from(tasks)
        .where(
          and(eq(tasks.orgId, db.orgId), eq(tasks.recurrenceParentId, task.id)),
        )
        .for("update");

      // Touched since it was written — the policy's own test, asked first so
      // the answer is a refusal and nothing has been written.
      if (
        children.some(
          (child) => child.updatedAt.getTime() !== child.createdAt.getTime(),
        )
      ) {
        return { ok: false };
      }

      if (children.length > 0) {
        const removed = await tx
          .delete(tasks)
          .where(
            and(
              eq(tasks.orgId, db.orgId),
              eq(tasks.recurrenceParentId, task.id),
            ),
          )
          .returning({ id: tasks.id });

        if (removed.length !== children.length) {
          throw new Error(
            "Undoing a completion removed fewer tasks than it found.",
          );
        }
      }

      await tx
        .update(tasks)
        .set({
          status: task.dueDate === null ? "unscheduled" : "scheduled",
          completedOn: null,
          actualCostCents: previous.data,
        })
        .where(and(eq(tasks.orgId, db.orgId), eq(tasks.id, task.id)));

      return { ok: true };
    });
  } catch (error) {
    throw withoutParameters(error, "Undoing a completed task");
  }
}

/**
 * `today`, or a date to put back — the unconfirm toast's Undo restores the day
 * it had rather than recording today — or null to clear it.
 */
const confirmationSchema = z.union([
  z.literal("today"),
  z.null(),
  z.string().refine(isCalendarDate),
]);

/**
 * The Scheduled tab's Status toggle (`maintenance.md`, #93): `Awaiting
 * confirmation` records today where the building is, and `Confirmed` clears
 * it. Each offers Undo, which calls this again with what was there.
 *
 * Only a scheduled task with an assignee — `tasks_confirmed_is_booked` in the
 * schema, checked here first so the answer is a refusal rather than an error.
 * A date put back may be no later than today.
 */
export async function setTaskConfirmation(
  taskId: unknown,
  confirmation: unknown,
): Promise<ConfirmTaskResult> {
  const { db } = await getOrgContext();

  const id = idSchema.safeParse(taskId);
  const value = confirmationSchema.safeParse(confirmation);
  if (!id.success || !value.success) return { ok: false };

  try {
    return await db.run(async (tx): Promise<ConfirmTaskResult> => {
      const locked = await lockTask(tx, db.orgId, id.data);
      if (!locked) return { ok: false };

      const { task } = locked;
      const assigned =
        task.assigneeContactId !== null || task.assigneeUserId !== null;
      if (task.status !== "scheduled" || !assigned) return { ok: false };

      const today = todayIn(locked.timezone);
      const confirmedOn = value.data === "today" ? today : value.data;
      if (confirmedOn !== null && confirmedOn > today) return { ok: false };

      await tx
        .update(tasks)
        .set({ confirmedOn })
        .where(and(eq(tasks.orgId, db.orgId), eq(tasks.id, task.id)));

      return { ok: true, confirmedOn };
    });
  } catch (error) {
    throw withoutParameters(error, "Confirming a task");
  }
}

export type SaveTaskResult =
  { ok: true; taskId: string } | { ok: false; errors: FieldErrors };

/**
 * Something the form named has gone since the modal opened: a contact
 * archived, an item replaced, a unit retired, the building archived.
 */
const SOMETHING_CHANGED =
  "Couldn’t save the task. Reload the page — something it names may have changed since you opened it.";

/** The two assignee columns, as the modal's choice sets them. */
type AssigneeColumns = {
  assigneeContactId: string | null;
  assigneeUserId: string | null;
};

/**
 * Everything the modal's form names, looked up inside the org and the task's
 * building before it is written, so a stale page is a refusal rather than a
 * failed constraint:
 *
 * - **a trade** on the list;
 * - **a contact** in the book and not archived — or the one the task already
 *   has, which archiving does not take off it;
 * - **a member**: `Me` is the session's own membership, and `A member` only
 *   keeps the other member the task already has, since v0 cannot name one;
 * - **an item** of this building in service — or the one the task already
 *   names, which a replacement leaves on it.
 *
 * Answers the assignee's columns, or null to refuse.
 */
async function checkReferences(
  tx: OrgScopedTx,
  orgId: string,
  viewerId: string,
  buildingId: string,
  values: TaskValues,
  current: {
    assigneeContactId: string | null;
    assigneeUserId: string | null;
    capitalItemId: string | null;
  } | null,
): Promise<AssigneeColumns | null> {
  if (values.tradeTag !== null) {
    const [trade] = await tx
      .select({ slug: tradeTags.slug })
      .from(tradeTags)
      .where(eq(tradeTags.slug, values.tradeTag));
    if (!trade) return null;
  }

  if (
    values.capitalItemId !== null &&
    values.capitalItemId !== current?.capitalItemId
  ) {
    const [item] = await tx
      .select({ id: capitalItems.id })
      .from(capitalItems)
      .where(
        and(
          eq(capitalItems.orgId, orgId),
          eq(capitalItems.buildingId, buildingId),
          eq(capitalItems.id, values.capitalItemId),
          eq(capitalItems.status, "active"),
        ),
      );
    if (!item) return null;
  }

  const { assignee } = values;
  if (assignee === null) {
    return { assigneeContactId: null, assigneeUserId: null };
  }
  if (assignee.kind === "me") {
    return { assigneeContactId: null, assigneeUserId: viewerId };
  }
  if (assignee.kind === "member") {
    const kept = current?.assigneeUserId ?? null;
    if (kept === null || kept === viewerId) return null;
    return { assigneeContactId: null, assigneeUserId: kept };
  }

  if (assignee.contactId !== current?.assigneeContactId) {
    const [contact] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.orgId, orgId),
          eq(contacts.id, assignee.contactId),
          isNull(contacts.archivedAt),
        ),
      );
    if (!contact) return null;
  }
  return { assigneeContactId: assignee.contactId, assigneeUserId: null };
}

/** The assignee `Select`'s value for what a row holds, as the viewer sees it. */
function assigneeOfRow(row: AssigneeColumns, viewerId: string): string {
  return assigneeField({
    assigneeContactId: row.assigneeContactId,
    assigneeKind:
      row.assigneeContactId !== null
        ? "contact"
        : row.assigneeUserId === null
          ? null
          : row.assigneeUserId === viewerId
            ? "me"
            : "member",
  });
}

/**
 * The task modal's `?task=new` (`modal-task-detail.md`): a task on an active
 * building — its own, or one of its units that is not retired — with the whole
 * form. **The date sets the status**: scheduled with one, unscheduled without.
 * A recurring task with no date waits unscheduled like any other, and is
 * first due whenever it is given one.
 */
export async function createTask(input: unknown): Promise<SaveTaskResult> {
  const { db, user } = await getOrgContext();

  const validated = validateTask(input, { kind: "new" });
  if (!validated.ok) return validated;

  const { values } = validated;

  try {
    return await db.run(async (tx): Promise<SaveTaskResult> => {
      // `for share`, for `addTask`'s reason.
      const [building] = await tx
        .select({ id: buildings.id, timezone: buildings.timezone })
        .from(buildings)
        .where(
          and(
            eq(buildings.orgId, db.orgId),
            eq(buildings.id, values.buildingId!),
            eq(buildings.status, "active"),
          ),
        )
        .for("share");

      if (!building) return refused(SOMETHING_CHANGED);

      if (values.unitId !== null) {
        const [unit] = await tx
          .select({ id: units.id })
          .from(units)
          .where(
            and(
              eq(units.orgId, db.orgId),
              eq(units.buildingId, building.id),
              eq(units.id, values.unitId),
              ne(units.status, "retired"),
            ),
          );

        if (!unit) return refused(SOMETHING_CHANGED);
      }

      const assignee = await checkReferences(
        tx,
        db.orgId,
        user.id,
        building.id,
        values,
        null,
      );
      if (!assignee) return refused(SOMETHING_CHANGED);

      const confirmedOn = confirmationOn(
        null,
        {
          confirmed: values.confirmed,
          dueDate: values.dueDate,
          assignee: assigneeOfRow(assignee, user.id),
        },
        todayIn(building.timezone),
      );

      const [added] = await tx
        .insert(tasks)
        .values({
          orgId: db.orgId,
          buildingId: building.id,
          unitId: values.unitId,
          capitalItemId: values.capitalItemId,
          title: values.title,
          notes: values.notes,
          tradeTag: values.tradeTag,
          status: values.dueDate === null ? "unscheduled" : "scheduled",
          priority: values.priority,
          dueDate: values.dueDate,
          confirmedOn,
          ...assignee,
          estCostCents: values.estCostCents,
          recurrenceMonths: values.recurrenceMonths,
        })
        .returning({ id: tasks.id });

      if (!added) throw new Error("Inserting a task returned no row.");

      return { ok: true, taskId: added.id };
    });
  } catch (error) {
    throw withoutParameters(error, "Creating a task");
  }
}

/**
 * The task modal's `Save` (`modal-task-detail.md`, the form). Its building and
 * scope are fixed once it is created.
 *
 * - **An open task's date sets its status**: a date schedules it and clearing
 *   the date unschedules it — `tasks_scheduled_has_date`, as a field.
 * - **Its confirmation follows `confirmationOn`**: kept for the booking that
 *   was confirmed, today for a new booking confirmed in the same save, and
 *   otherwise cleared. `tasks_clear_confirmation` clears a confirmation on a
 *   rebooking unless the statement changes `confirmed_on` too — which a
 *   booking confirmed earlier today, rebooked and confirmed again, does not:
 *   it writes the value it had. So that confirmation is written again on its
 *   own.
 * - **A done task** keeps its status, and saves when it was done and what it
 *   cost in place of a date and a repeat. Its confirmation is history, and is
 *   left to the database — cleared only if the assignee changes.
 *
 * Only a task that is not cancelled, on an active building, as every write
 * here.
 */
export async function updateTask(
  taskId: unknown,
  input: unknown,
): Promise<SaveTaskResult> {
  const { db, user } = await getOrgContext();

  const id = idSchema.safeParse(taskId);
  if (!id.success) return refused(SOMETHING_CHANGED);

  try {
    return await db.run(async (tx): Promise<SaveTaskResult> => {
      const locked = await lockTask(tx, db.orgId, id.data);
      if (!locked) return refused(SOMETHING_CHANGED);

      const { task } = locked;
      const today = todayIn(locked.timezone);
      const done = task.status === "done";

      const validated = validateTask(
        input,
        done ? { kind: "done", today } : { kind: "open" },
      );
      if (!validated.ok) return validated;

      const { values } = validated;

      const assignee = await checkReferences(
        tx,
        db.orgId,
        user.id,
        task.buildingId,
        values,
        task,
      );
      if (!assignee) return refused(SOMETHING_CHANGED);

      const common = {
        title: values.title,
        notes: values.notes,
        tradeTag: values.tradeTag,
        priority: values.priority,
        capitalItemId: values.capitalItemId,
        estCostCents: values.estCostCents,
        ...assignee,
      };
      const where = and(eq(tasks.orgId, db.orgId), eq(tasks.id, task.id));

      if (done) {
        await tx
          .update(tasks)
          .set({
            ...common,
            completedOn: values.completedOn,
            actualCostCents: values.actualCostCents,
          })
          .where(where);

        return { ok: true, taskId: task.id };
      }

      const confirmedOn = confirmationOn(
        {
          confirmedOn: task.confirmedOn,
          dueDate: task.dueDate,
          assignee: assigneeOfRow(task, user.id),
        },
        {
          confirmed: values.confirmed,
          dueDate: values.dueDate,
          assignee: assigneeOfRow(assignee, user.id),
        },
        today,
      );

      const [written] = await tx
        .update(tasks)
        .set({
          ...common,
          status: values.dueDate === null ? "unscheduled" : "scheduled",
          dueDate: values.dueDate,
          recurrenceMonths: values.recurrenceMonths,
          confirmedOn,
        })
        .where(where)
        .returning({ confirmedOn: tasks.confirmedOn });

      if (confirmedOn !== null && written?.confirmedOn === null) {
        await tx.update(tasks).set({ confirmedOn }).where(where);
      }

      return { ok: true, taskId: task.id };
    });
  } catch (error) {
    throw withoutParameters(error, "Saving a task");
  }
}

/**
 * The task modal's `Cancel task` (`modal-task-detail.md`, footer): work that
 * will not happen. The task is kept, with its history, and the task tables
 * leave it out; a recurring one writes no next occurrence. Its confirmation
 * goes with it, since a cancelled task is booked with nobody
 * (`tasks_confirmed_is_booked`).
 *
 * Only an open task: a done one happened, and stays done.
 */
export async function cancelTask(taskId: unknown): Promise<TaskWriteResult> {
  const { db } = await getOrgContext();

  const id = idSchema.safeParse(taskId);
  if (!id.success) return { ok: false };

  try {
    return await db.run(async (tx): Promise<TaskWriteResult> => {
      const locked = await lockTask(tx, db.orgId, id.data);
      if (!locked || locked.task.status === "done") return { ok: false };

      await tx
        .update(tasks)
        .set({ status: "canceled", confirmedOn: null })
        .where(and(eq(tasks.orgId, db.orgId), eq(tasks.id, locked.task.id)));

      return { ok: true };
    });
  } catch (error) {
    throw withoutParameters(error, "Cancelling a task");
  }
}
