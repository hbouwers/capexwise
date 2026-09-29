/**
 * Planned work inside one org (#96): the forecast's two writes, what a
 * replacement or a removal does to a plan, and the rules `planned_work` holds
 * itself to. The cross-org half is the isolation test's.
 *
 * Driven as the page drives them — a signed session, then the function — as
 * `reserve.integration.test.ts` does, whose session setup this repeats.
 */
import { makeSignature } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { buildings, plannedWork, transactions } from "@/db/schema";
import { todayIn, yearOf } from "@/lib/dates";
import { applicationDatabaseUrl, testDb } from "@/test/db";
import {
  createBuilding,
  createCapitalItem,
  createMembership,
  createOrganization,
  createPlannedWork,
  createTransaction,
  createUser,
} from "@/test/factories";
import {
  CHECK_VIOLATION,
  rejectsWith,
  UNIQUE_VIOLATION,
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

// Dynamic, and after the assignments above, for the reason the isolation test
// gives.
const { getAuth } = await import("@/server/auth");
const { dropPlan, planReplacement } =
  await import("@/server/actions/planned-work");
const { recordReplacement, removeCapitalItem, undoAddCapitalItems } =
  await import("@/server/actions/capital-items");
const { deleteExpense } = await import("@/server/actions/expenses");
const { getForecastInputs } = await import("@/server/queries/forecast");

const ZONE = "America/Indiana/Indianapolis";
const THIS_YEAR = yearOf(todayIn(ZONE));

/** An org with its owner signed in, a building and a furnace on it. */
async function signedInWithItem() {
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
  const item = await createCapitalItem(org.id, building.id);

  return { org, building, item };
}

async function plansOf(itemId: string) {
  return await testDb()
    .select({
      plannedYear: plannedWork.plannedYear,
      status: plannedWork.status,
    })
    .from(plannedWork)
    .where(eq(plannedWork.capitalItemId, itemId))
    .orderBy(plannedWork.id);
}

describe("planReplacement", () => {
  it("makes the item's live plan, then moves it rather than adding another", async () => {
    const { item } = await signedInWithItem();

    expect(await planReplacement(item.id, THIS_YEAR + 3)).toEqual({ ok: true });
    expect(await planReplacement(item.id, THIS_YEAR + 5)).toEqual({ ok: true });

    expect(await plansOf(item.id)).toEqual([
      { plannedYear: THIS_YEAR + 5, status: "planned" },
    ]);
  });

  it("keeps a dropped plan and makes a new one beside it", async () => {
    const { item } = await signedInWithItem();

    await planReplacement(item.id, THIS_YEAR + 3);
    expect(await dropPlan(item.id)).toEqual({ ok: true });
    await planReplacement(item.id, THIS_YEAR + 1);

    expect(await plansOf(item.id)).toEqual([
      { plannedYear: THIS_YEAR + 3, status: "dropped" },
      { plannedYear: THIS_YEAR + 1, status: "planned" },
    ]);
  });

  it("takes this year, and refuses a year already gone", async () => {
    const { item } = await signedInWithItem();

    expect(await planReplacement(item.id, THIS_YEAR - 1)).toEqual({
      ok: false,
    });
    expect(await planReplacement(item.id, THIS_YEAR)).toEqual({ ok: true });
  });

  it("refuses an item out of service, and one on an archived building", async () => {
    const { org, building, item } = await signedInWithItem();
    const removed = await createCapitalItem(org.id, building.id, {
      status: "removed",
    });

    expect(await planReplacement(removed.id, THIS_YEAR + 2)).toEqual({
      ok: false,
    });

    await testDb()
      .update(buildings)
      .set({ status: "archived" })
      .where(eq(buildings.id, building.id));
    expect(await planReplacement(item.id, THIS_YEAR + 2)).toEqual({
      ok: false,
    });
    expect(await plansOf(item.id)).toEqual([]);
  });
});

describe("dropPlan", () => {
  it("refuses an item with no live plan", async () => {
    const { org, building, item } = await signedInWithItem();
    await createPlannedWork(org.id, building.id, {
      capitalItemId: item.id,
      status: "dropped",
    });

    expect(await dropPlan(item.id)).toEqual({ ok: false });
  });
});

describe("an item leaving service", () => {
  it("marks its plan done when it is replaced", async () => {
    const { item } = await signedInWithItem();
    await planReplacement(item.id, THIS_YEAR + 2);

    expect(
      await recordReplacement(item.id, {
        installedOn: `${THIS_YEAR}-06-01`,
        cost: "",
      }),
    ).toMatchObject({ ok: true });

    expect(await plansOf(item.id)).toEqual([
      { plannedYear: THIS_YEAR + 2, status: "done" },
    ]);
  });

  it("drops its plan when it is removed", async () => {
    const { item } = await signedInWithItem();
    await planReplacement(item.id, THIS_YEAR + 2);

    expect(await removeCapitalItem(item.id)).toEqual({ ok: true });

    expect(await plansOf(item.id)).toEqual([
      { plannedYear: THIS_YEAR + 2, status: "dropped" },
    ]);
  });

  it("takes a plan with it when the add is undone", async () => {
    const { building, item } = await signedInWithItem();
    await planReplacement(item.id, THIS_YEAR + 2);

    expect(await undoAddCapitalItems(building.id, [item.id])).toEqual({
      ok: true,
      removed: 1,
    });
    expect(await plansOf(item.id)).toEqual([]);
  });
});

describe("getForecastInputs", () => {
  it("reads an item's live plan, and not a done or dropped one", async () => {
    const { org, building, item } = await signedInWithItem();
    const other = await createCapitalItem(org.id, building.id);
    await createPlannedWork(org.id, building.id, {
      capitalItemId: other.id,
      plannedYear: 2027,
      status: "dropped",
    });
    await createPlannedWork(org.id, building.id, {
      capitalItemId: item.id,
      plannedYear: 2031,
    });

    const { items } = await getForecastInputs();
    const planned = new Map(items.map((row) => [row.id, row.plannedYear]));

    expect(planned.get(item.id)).toBe(2031);
    expect(planned.get(other.id)).toBeNull();
    expect(items).toHaveLength(2);
  });
});

describe("planned_work", () => {
  it("holds an item to one live plan, and any number of closed ones", async () => {
    const { org, building, item } = await signedInWithItem();
    await createPlannedWork(org.id, building.id, {
      capitalItemId: item.id,
      status: "dropped",
    });
    await createPlannedWork(org.id, building.id, { capitalItemId: item.id });

    await expect(
      createPlannedWork(org.id, building.id, { capitalItemId: item.id }),
    ).rejects.toSatisfy(rejectsWith(UNIQUE_VIOLATION));
  });

  it("takes an item's plan or a project, and nothing in between", async () => {
    const { org, building, item } = await signedInWithItem();

    // A project needs its own name and cost; an item's plan has neither.
    for (const overrides of [
      { title: "Retile the bathroom" },
      { estCostCents: 650_000 },
      { capitalItemId: item.id, title: "Furnace" },
      { capitalItemId: item.id, estCostCents: 480_000 },
    ]) {
      await expect(
        createPlannedWork(org.id, building.id, overrides),
      ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
    }

    await createPlannedWork(org.id, building.id, {
      title: "Retile the bathroom",
      estCostCents: 650_000,
    });
  });

  it("points only a done plan at an expense, and loses the pointer, not the plan, when the expense goes", async () => {
    const { org, building, item } = await signedInWithItem();
    const expense = await createTransaction(org.id, building.id, {
      capitalItemId: item.id,
    });

    await expect(
      createPlannedWork(org.id, building.id, {
        capitalItemId: item.id,
        transactionId: expense.id,
      }),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));

    const plan = await createPlannedWork(org.id, building.id, {
      capitalItemId: item.id,
      status: "done",
      transactionId: expense.id,
    });
    await testDb()
      .delete(transactions)
      .where(
        and(eq(transactions.orgId, org.id), eq(transactions.id, expense.id)),
      );

    const [after] = await testDb()
      .select({
        status: plannedWork.status,
        transactionId: plannedWork.transactionId,
      })
      .from(plannedWork)
      .where(eq(plannedWork.id, plan.id));
    expect(after).toEqual({ status: "done", transactionId: null });
  });

  it("does not stop an expense from being deleted in the modal", async () => {
    const { org, building, item } = await signedInWithItem();
    const expense = await createTransaction(org.id, building.id, {
      capitalItemId: item.id,
    });
    await createPlannedWork(org.id, building.id, {
      capitalItemId: item.id,
      status: "done",
      transactionId: expense.id,
    });

    expect(await deleteExpense(expense.id)).toEqual({ ok: true });
  });
});
