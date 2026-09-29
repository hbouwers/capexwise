"use server";

/**
 * The expense modal's writes (`docs/ui/screens/expenses.md`): add, save and
 * delete. Each starts with `getOrgContext()`, so the org is the session's, and
 * every id the browser sends — a building, a unit, an item, a contact — is
 * looked up inside that org rather than trusted. Every input is `unknown`, and
 * `validateExpense` is the same function the modal runs.
 *
 * **Only an active building's spend is written.** An archived or sold
 * building is kept for its history and its expenses are shown read-only, as
 * its tasks are.
 *
 * **Nothing an expense holds is logged**, including in a failed save's error:
 * a description is free text, and may name a tenant. A write that fails is
 * re-thrown with its SQLSTATE only (`src/lib/query-errors.ts`).
 */

import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import {
  buildings,
  capitalItems,
  contacts,
  transactions,
  units,
} from "@/db/schema";
import { todayIn } from "@/lib/dates";
import {
  type ExpenseValues,
  FUTURE_DATE,
  validateExpense,
} from "@/lib/expense-form";
import { type FieldErrors, UNREADABLE_FORM } from "@/lib/forms";
import { sqlState, withoutParameters } from "@/lib/query-errors";
import { getOrgContext, type OrgScopedTx } from "@/server/org-context";

export type SaveExpenseResult =
  { ok: true; expenseId: string } | { ok: false; errors: FieldErrors };

/**
 * A building archived, or a unit retired, between the page drawing and the
 * save — the form is out of date, and reloading is the fix.
 */
const BUILDING_NOT_FOUND =
  "The expense could not be saved. Reload the page — the building may have changed since you opened it.";

/**
 * The same words for an expense that does not exist and one in another org,
 * so an action cannot be used to learn which ids exist.
 */
const NOT_FOUND =
  "This expense could not be found. It may have been deleted, or be in another organization.";

/** A reference to a row that is not there: here, a category not on the list. */
const FOREIGN_KEY_VIOLATION = "23503";

const idSchema = z.uuid();

function refused(message: string): { ok: false; errors: FieldErrors } {
  return { ok: false, errors: { form: message } };
}

/** What the expense already links to, which a save may keep. */
type Kept = {
  unitId: string | null;
  capitalItemId: string | null;
  contactId: string | null;
};

const NOTHING_KEPT: Kept = {
  unitId: null,
  capitalItemId: null,
  contactId: null,
};

/**
 * Checks what a save names against the org, inside the save's transaction,
 * and answers with the refusal to give or null for none.
 *
 * - **The building is active**, taken `for share` so the building form, which
 *   takes it `for update` before retiring a unit, waits for the save.
 * - **The date is not after today where the building is** — the check
 *   `validateExpense` left for here, once the zone is known.
 * - **A unit is the building's and not retired; an item is the building's and
 *   in service; a contact is the org's and not archived** — or each is the one
 *   the expense already names, which a save keeps even after it has left.
 *
 * A category is left to its foreign key, which the caller turns into the
 * form's one message for a request the form did not make.
 */
async function refusal(
  tx: OrgScopedTx,
  orgId: string,
  values: ExpenseValues,
  kept: Kept,
): Promise<{ ok: false; errors: FieldErrors } | null> {
  const [building] = await tx
    .select({ timezone: buildings.timezone })
    .from(buildings)
    .where(
      and(
        eq(buildings.orgId, orgId),
        eq(buildings.id, values.buildingId),
        eq(buildings.status, "active"),
      ),
    )
    .for("share");

  if (!building) return refused(BUILDING_NOT_FOUND);

  if (values.occurredOn > todayIn(building.timezone)) {
    return { ok: false, errors: { occurredOn: FUTURE_DATE } };
  }

  if (values.unitId !== null) {
    const [unit] = await tx
      .select({ id: units.id })
      .from(units)
      .where(
        and(
          eq(units.orgId, orgId),
          eq(units.buildingId, values.buildingId),
          eq(units.id, values.unitId),
          values.unitId === kept.unitId
            ? undefined
            : ne(units.status, "retired"),
        ),
      );

    if (!unit) return refused(BUILDING_NOT_FOUND);
  }

  if (values.capitalItemId !== null) {
    const [item] = await tx
      .select({ id: capitalItems.id })
      .from(capitalItems)
      .where(
        and(
          eq(capitalItems.orgId, orgId),
          eq(capitalItems.buildingId, values.buildingId),
          eq(capitalItems.id, values.capitalItemId),
          values.capitalItemId === kept.capitalItemId
            ? undefined
            : eq(capitalItems.status, "active"),
        ),
      );

    if (!item) return refused(UNREADABLE_FORM);
  }

  if (values.contactId !== null) {
    const [contact] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.orgId, orgId),
          eq(contacts.id, values.contactId),
          values.contactId === kept.contactId
            ? undefined
            : isNull(contacts.archivedAt),
        ),
      );

    if (!contact) return refused(UNREADABLE_FORM);
  }

  return null;
}

/**
 * Runs a save, and turns its failure into something safe to say and to log —
 * the contact actions' `save`. A category that is well-formed and not on the
 * list is refused by its foreign key; the modal only offers ones that are, so
 * it gets the form's one message for a request the form did not make.
 */
async function save(
  what: string,
  write: () => Promise<SaveExpenseResult>,
): Promise<SaveExpenseResult> {
  try {
    return await write();
  } catch (error) {
    if (sqlState(error) === FOREIGN_KEY_VIOLATION) {
      return refused(UNREADABLE_FORM);
    }

    throw withoutParameters(error, what);
  }
}

/**
 * A new expense. A task is never named here: the one path that links spend
 * to a job is `Mark done`, which writes the expense with the completion
 * (`src/server/actions/tasks.ts`), so whatever `taskId` arrives is dropped.
 */
export async function createExpense(
  input: unknown,
): Promise<SaveExpenseResult> {
  const { db } = await getOrgContext();

  const validated = validateExpense(input, null);
  if (!validated.ok) return validated;

  const values = { ...validated.values, taskId: null };

  return await save("Adding an expense", () =>
    db.run(async (tx): Promise<SaveExpenseResult> => {
      const refuse = await refusal(tx, db.orgId, values, NOTHING_KEPT);
      if (refuse) return refuse;

      const [row] = await tx
        .insert(transactions)
        .values({ ...values, orgId: db.orgId })
        .returning({ id: transactions.id });

      if (!row) throw new Error("Inserting an expense returned no row.");

      return { ok: true, expenseId: row.id };
    }),
  );
}

/**
 * The modal's save on an existing expense: every field, on the same building
 * or another active one. The task it paid for is kept as it was — the modal
 * shows it and does not offer to change it — whatever `taskId` arrives.
 */
export async function updateExpense(
  expenseId: unknown,
  input: unknown,
): Promise<SaveExpenseResult> {
  const { db } = await getOrgContext();

  const id = idSchema.safeParse(expenseId);
  if (!id.success) return refused(NOT_FOUND);

  const validated = validateExpense(input, null);
  if (!validated.ok) return validated;

  return await save("Saving an expense", () =>
    db.run(async (tx): Promise<SaveExpenseResult> => {
      const [existing] = await tx
        .select({
          buildingId: transactions.buildingId,
          unitId: transactions.unitId,
          capitalItemId: transactions.capitalItemId,
          contactId: transactions.contactId,
          taskId: transactions.taskId,
          status: buildings.status,
        })
        .from(transactions)
        .innerJoin(
          buildings,
          and(
            eq(buildings.orgId, transactions.orgId),
            eq(buildings.id, transactions.buildingId),
          ),
        )
        .where(
          and(eq(transactions.orgId, db.orgId), eq(transactions.id, id.data)),
        )
        .for("update", { of: transactions });

      if (!existing) return refused(NOT_FOUND);
      if (existing.status !== "active") return refused(BUILDING_NOT_FOUND);

      // A task names its building, so an expense moved to another building
      // leaves its job behind rather than pointing across.
      const values = {
        ...validated.values,
        taskId:
          validated.values.buildingId === existing.buildingId
            ? existing.taskId
            : null,
      };

      const refuse = await refusal(
        tx,
        db.orgId,
        values,
        values.buildingId === existing.buildingId ? existing : NOTHING_KEPT,
      );
      if (refuse) return refuse;

      await tx
        .update(transactions)
        .set(values)
        .where(
          and(eq(transactions.orgId, db.orgId), eq(transactions.id, id.data)),
        );

      return { ok: true, expenseId: id.data };
    }),
  );
}

/**
 * Deletes an expense entered by mistake — twice, or against the wrong
 * building. `ok: false` for one that is not there, not this org's, or on a
 * building that is not active; the modal has nothing different to say about
 * any of them.
 */
export async function deleteExpense(
  expenseId: unknown,
): Promise<{ ok: boolean }> {
  const { db } = await getOrgContext();

  const id = idSchema.safeParse(expenseId);
  if (!id.success) return { ok: false };

  try {
    return await db.run(async (tx) => {
      const [existing] = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .innerJoin(
          buildings,
          and(
            eq(buildings.orgId, transactions.orgId),
            eq(buildings.id, transactions.buildingId),
          ),
        )
        .where(
          and(
            eq(transactions.orgId, db.orgId),
            eq(transactions.id, id.data),
            eq(buildings.status, "active"),
          ),
        )
        .for("share", { of: buildings });

      if (!existing) return { ok: false };

      const rows = await tx
        .delete(transactions)
        .where(
          and(eq(transactions.orgId, db.orgId), eq(transactions.id, id.data)),
        )
        .returning({ id: transactions.id });

      return { ok: rows.length === 1 };
    });
  } catch (error) {
    throw withoutParameters(error, "Deleting an expense");
  }
}
