/**
 * What the expense modal's writes and the expenses page's read do inside one
 * org: the sign and the classification as stored, what a save may still name
 * once it has gone out of service, a task link that follows its building, and
 * the table's own rules — a zero refused, a task's delete unlinking its
 * expense, an item's delete refused while spend names it. The cross-org half
 * is the isolation test's.
 *
 * Driven as the modal drives them — a signed session, then the action — so the
 * org comes from `getOrgContext()` as it does in a request. The session setup
 * is the isolation test's, which explains each line.
 */
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { capitalItems, rentPeriods, tasks, transactions } from "@/db/schema";
import { addDays, addMonths, firstOfMonth, todayIn } from "@/lib/dates";
import {
  emptyExpenseFields,
  type ExpenseFields,
  FUTURE_DATE,
} from "@/lib/expense-form";
import { UNREADABLE_FORM } from "@/lib/forms";
import { monthParam } from "@/lib/rent";
import { applicationDatabaseUrl, testDb } from "@/test/db";
import {
  createBuilding,
  createCapitalItem,
  createContact,
  createMembership,
  createOrganization,
  createTask,
  createTransaction,
  createUnit,
  createUser,
} from "@/test/factories";
import {
  CHECK_VIOLATION,
  rejectsWith,
  RESTRICT_VIOLATION,
} from "@/test/postgres-errors";

const request = vi.hoisted(() => ({ headers: new Headers() }));

vi.mock("next/headers", () => ({
  headers: async () => request.headers,
}));

process.env.DATABASE_URL = applicationDatabaseUrl;
process.env.APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "integration-suite-secret-not-a-real-one";
process.env.GOOGLE_CLIENT_ID = "integration-suite-client-id";
process.env.GOOGLE_CLIENT_SECRET = "integration-suite-client-secret";
// Base64url of "integration-suite-not-a-real-key": a shape, not a secret.
process.env.ACCESS_CODE_KEYS = "1:aW50ZWdyYXRpb24tc3VpdGUtbm90LWEtcmVhbC1rZXk";

// Dynamic, and after the assignments above, for the reason the isolation test
// gives.
const { getAuth } = await import("@/server/auth");
const { createExpense, deleteExpense, updateExpense } =
  await import("@/server/actions/expenses");
const { getExpensesPage, getPortfolioSpend } =
  await import("@/server/queries/expenses");

const ZONE = "America/Indiana/Indianapolis";

/** An org with an owner and one duplex, signed in as the requests below. */
async function signedInOrg() {
  const org = await createOrganization();
  const owner = await createUser();
  await createMembership(org.id, owner.id, { role: "owner" });

  const context = await getAuth().$context;
  const session = await context.internalAdapter.createSession(owner.id, false);
  const signature = await makeSignature(session.token, context.secret);

  request.headers = new Headers({
    cookie: `${context.authCookies.sessionToken.name}=${session.token}.${signature}`,
  });

  const building = await createBuilding(org.id, { timezone: ZONE });
  const unit = await createUnit(org.id, building.id, {
    label: "A",
    status: "occupied",
    rentCents: 150_000,
  });

  return { org, building, unit };
}

function receipt(
  buildingId: string,
  overrides: Partial<ExpenseFields> = {},
): ExpenseFields {
  return {
    ...emptyExpenseFields({ today: "2026-09-16" }),
    amount: "180",
    buildingId,
    category: "repairs",
    description: "Replaced the kitchen faucet",
    ...overrides,
  };
}

async function stored(id: string) {
  const [row] = await testDb()
    .select()
    .from(transactions)
    .where(eq(transactions.id, id));

  return row;
}

describe("createExpense", () => {
  it("stores money out as negative cents, and a repair unclassified", async () => {
    const { org, building } = await signedInOrg();

    const result = await createExpense(receipt(building.id));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;

    expect(await stored(result.expenseId)).toMatchObject({
      orgId: org.id,
      buildingId: building.id,
      unitId: null,
      occurredOn: "2026-09-16",
      amountCents: -18_000,
      scheduleECategory: "repairs",
      classification: "unclassified",
    });
  });

  it("stores a refund as positive, and no classification where none is asked", async () => {
    const { building, unit } = await signedInOrg();

    const result = await createExpense(
      receipt(building.id, {
        direction: "refund",
        amount: "40",
        scope: unit.id,
        category: "supplies",
        classification: "improvement",
      }),
    );
    if (!result.ok) throw new Error("The refund was refused.");

    expect(await stored(result.expenseId)).toMatchObject({
      unitId: unit.id,
      amountCents: 4_000,
      classification: null,
    });
  });

  it("refuses a date after today where the building is", async () => {
    const { building } = await signedInOrg();
    const tomorrow = addDays(todayIn(ZONE), 1);

    expect(
      await createExpense(receipt(building.id, { occurredOn: tomorrow })),
    ).toEqual({ ok: false, errors: { occurredOn: FUTURE_DATE } });
  });

  it("refuses an archived building, a retired unit, a removed item and an archived contact", async () => {
    const { org, building } = await signedInOrg();
    const archived = await createBuilding(org.id, { status: "archived" });
    const retired = await createUnit(org.id, building.id, {
      status: "retired",
    });
    const removed = await createCapitalItem(org.id, building.id, {
      status: "removed",
    });
    const gone = await createContact(org.id, { archivedAt: new Date() });

    for (const input of [
      receipt(archived.id),
      receipt(building.id, { scope: retired.id }),
      receipt(building.id, { equipment: removed.id }),
      receipt(building.id, { contact: gone.id }),
    ]) {
      expect((await createExpense(input)).ok).toBe(false);
    }

    expect(await testDb().select().from(transactions)).toEqual([]);
  });

  it("refuses a category not on the list with the form's one message", async () => {
    const { building } = await signedInOrg();

    expect(
      await createExpense(receipt(building.id, { category: "depreciation" })),
    ).toEqual({ ok: false, errors: { form: UNREADABLE_FORM } });
  });

  it("links no task, whatever the form sends", async () => {
    const { org, building } = await signedInOrg();
    const task = await createTask(org.id, building.id);

    const result = await createExpense(
      receipt(building.id, { taskId: task.id }),
    );
    if (!result.ok) throw new Error("The expense was refused.");

    expect((await stored(result.expenseId))?.taskId).toBeNull();
  });
});

describe("updateExpense", () => {
  it("keeps its task, and a contact archived since, on the same building", async () => {
    const { org, building } = await signedInOrg();
    const task = await createTask(org.id, building.id);
    const contact = await createContact(org.id, { archivedAt: new Date() });
    const expense = await createTransaction(org.id, building.id, {
      taskId: task.id,
      contactId: contact.id,
    });

    const result = await updateExpense(
      expense.id,
      receipt(building.id, { amount: "195", contact: contact.id, taskId: "" }),
    );
    expect(result).toEqual({ ok: true, expenseId: expense.id });

    expect(await stored(expense.id)).toMatchObject({
      amountCents: -19_500,
      taskId: task.id,
      contactId: contact.id,
    });
  });

  it("leaves its task behind when it moves to another building", async () => {
    const { org, building } = await signedInOrg();
    const other = await createBuilding(org.id);
    const task = await createTask(org.id, building.id);
    const expense = await createTransaction(org.id, building.id, {
      taskId: task.id,
    });

    expect(
      await updateExpense(expense.id, receipt(other.id, { taskId: task.id })),
    ).toMatchObject({ ok: true });

    expect(await stored(expense.id)).toMatchObject({
      buildingId: other.id,
      taskId: null,
    });
  });

  it("keeps an archived contact when it moves to another building", async () => {
    const { org, building } = await signedInOrg();
    const other = await createBuilding(org.id);
    const contact = await createContact(org.id, { archivedAt: new Date() });
    const expense = await createTransaction(org.id, building.id, {
      contactId: contact.id,
    });

    expect(
      await updateExpense(
        expense.id,
        receipt(other.id, { contact: contact.id }),
      ),
    ).toMatchObject({ ok: true });
    expect(await stored(expense.id)).toMatchObject({
      buildingId: other.id,
      contactId: contact.id,
    });
  });

  it("refuses an expense on a building archived since", async () => {
    const { org } = await signedInOrg();
    const archived = await createBuilding(org.id, { status: "archived" });
    const expense = await createTransaction(org.id, archived.id);

    expect((await updateExpense(expense.id, receipt(archived.id))).ok).toBe(
      false,
    );
    expect(await deleteExpense(expense.id)).toEqual({ ok: false });
  });
});

describe("deleteExpense", () => {
  it("deletes it, once", async () => {
    const { org, building } = await signedInOrg();
    const expense = await createTransaction(org.id, building.id);

    expect(await deleteExpense(expense.id)).toEqual({ ok: true });
    expect(await deleteExpense(expense.id)).toEqual({ ok: false });
    expect(await stored(expense.id)).toBeUndefined();
  });
});

describe("the table", () => {
  it("refuses an amount of zero", async () => {
    const { org, building } = await signedInOrg();

    await expect(
      createTransaction(org.id, building.id, { amountCents: 0 }),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
  });

  it("unlinks an expense from a task that is deleted, and keeps the expense", async () => {
    const { org, building } = await signedInOrg();
    const task = await createTask(org.id, building.id);
    const expense = await createTransaction(org.id, building.id, {
      taskId: task.id,
    });

    await testDb().delete(tasks).where(eq(tasks.id, task.id));

    expect(await stored(expense.id)).toMatchObject({
      orgId: org.id,
      buildingId: building.id,
      taskId: null,
    });
  });

  it("refuses to delete an item that spend is recorded against", async () => {
    const { org, building } = await signedInOrg();
    const item = await createCapitalItem(org.id, building.id);
    await createTransaction(org.id, building.id, { capitalItemId: item.id });

    await expect(
      testDb().delete(capitalItems).where(eq(capitalItems.id, item.id)),
    ).rejects.toSatisfy(rejectsWith(RESTRICT_VIOLATION));
  });
});

describe("getPortfolioSpend", () => {
  it("nets this month's and this year's spend per building, and nothing earlier", async () => {
    const { org, building } = await signedInOrg();
    const month = firstOfMonth(todayIn(ZONE));
    const january = `${month.slice(0, 4)}-01-01`;

    await createTransaction(org.id, building.id, { occurredOn: month });
    await createTransaction(org.id, building.id, {
      occurredOn: month,
      amountCents: 4_000,
    });
    if (january !== month) {
      await createTransaction(org.id, building.id, { occurredOn: january });
    }
    await createTransaction(org.id, building.id, {
      occurredOn: addDays(january, -1),
    });

    const spend = await getPortfolioSpend();

    expect(spend.get(building.id)).toEqual({
      monthCents: 14_000,
      yearCents: january === month ? 14_000 : 32_000,
    });
  });
});

describe("getExpensesPage", () => {
  it("reads the period's year to date, and leaves an archived building out", async () => {
    const { org, building } = await signedInOrg();
    const archived = await createBuilding(org.id, { status: "archived" });
    const march = await createTransaction(org.id, building.id, {
      occurredOn: "2026-03-10",
    });
    const january = await createTransaction(org.id, building.id, {
      occurredOn: "2026-01-02",
      amountCents: -5_000,
    });
    await createTransaction(org.id, building.id, { occurredOn: "2026-04-01" });
    await createTransaction(org.id, building.id, { occurredOn: "2025-12-31" });
    await createTransaction(org.id, archived.id, { occurredOn: "2026-03-11" });

    const page = await getExpensesPage("2026-03");

    expect(page.period).toEqual({ kind: "month", month: "2026-03-01" });
    expect(page.buildings.map((b) => b.id)).toEqual([building.id]);
    // Newest first, January through March, and nothing from the archive.
    expect(page.expenses.map((expense) => expense.id)).toEqual([
      march.id,
      january.id,
    ]);
  });

  it("opens the current month's rent on viewing it, and no other", async () => {
    await signedInOrg();
    const month = firstOfMonth(todayIn(ZONE));
    const opened = async () =>
      (await testDb().select().from(rentPeriods)).map((p) => p.periodMonth);

    await getExpensesPage(monthParam(addMonths(month, -1)));
    expect(await opened()).toEqual([]);

    const page = await getExpensesPage(null);
    expect(page.period).toEqual({ kind: "month", month });
    expect(page.rent.map((period) => period.periodMonth)).toEqual([month]);
    expect(await opened()).toEqual([month]);
  });
});
