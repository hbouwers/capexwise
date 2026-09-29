/**
 * What the task writes do inside one org: the add row, a completion that
 * writes the next occurrence and an Undo that takes it back only while nobody
 * has touched it, the confirmation toggle, and the task modal's add, save,
 * Mark done and Cancel task. The reads' assignees and
 * filters are here too. The cross-org half is the isolation test's.
 *
 * Driven as the pages drive them — a signed session, then the function — as
 * `capital-items.integration.test.ts` does, whose session setup this repeats.
 */
import { makeSignature } from "better-auth/crypto";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { buildings, tasks, transactions } from "@/db/schema";
import { addMonthsKeepingDay, todayIn } from "@/lib/dates";
import { emptyTaskFields, ME, MEMBER, type TaskFields } from "@/lib/task-form";
import { nextOccurrence } from "@/lib/tasks";
import { applicationDatabaseUrl, testDb } from "@/test/db";
import {
  createBuilding,
  createCapitalItem,
  createContact,
  createMembership,
  createOrganization,
  createTask,
  createUnit,
  createUser,
} from "@/test/factories";

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
const {
  addTask,
  cancelTask,
  completeTask,
  createTask: saveNewTask,
  setTaskConfirmation,
  undoCompleteTask,
  updateTask,
} = await import("@/server/actions/tasks");
const { getMaintenanceInputs, getRecurringTasks, getTaskModal } =
  await import("@/server/queries/tasks");

const ZONE = "America/Indiana/Indianapolis";
const today = todayIn(ZONE);

/**
 * A duplex and its owner, signed in as the requests below, with a third unit
 * that was retired, and a plumber in the contact book.
 */
async function duplex() {
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
  const a = await createUnit(org.id, building.id, { label: "A" });
  const b = await createUnit(org.id, building.id, { label: "B" });
  const c = await createUnit(org.id, building.id, {
    label: "C",
    status: "retired",
  });
  const plumber = await createContact(org.id, { name: "Dana Whitfield" });

  return { org, owner, building, a, b, c, plumber };
}

async function tasksOf(buildingId: string) {
  return await testDb()
    .select()
    .from(tasks)
    .where(eq(tasks.buildingId, buildingId))
    .orderBy(asc(tasks.id));
}

const oneOff = (buildingId: string, scope = "shared") => ({
  title: "Replace the porch light",
  buildingId,
  scope,
  recurrence: "",
});

describe("addTask", () => {
  it("adds a one-off waiting for a date, on the building or a unit", async () => {
    const { building, a } = await duplex();

    const shared = await addTask(oneOff(building.id));
    const unit = await addTask(oneOff(building.id, a.id));

    expect(shared).toMatchObject({ ok: true, dueDate: null });
    expect(unit).toMatchObject({ ok: true, dueDate: null });
    expect(await tasksOf(building.id)).toMatchObject([
      {
        unitId: null,
        status: "unscheduled",
        dueDate: null,
        recurrenceMonths: null,
      },
      { unitId: a.id, status: "unscheduled", dueDate: null },
    ]);
  });

  it("schedules a recurring task one interval from today", async () => {
    const { building } = await duplex();

    const result = await addTask({
      title: "Service the furnace",
      buildingId: building.id,
      scope: "shared",
      recurrence: "12",
    });

    const due = addMonthsKeepingDay(today, 12);
    expect(result).toMatchObject({ ok: true, dueDate: due });
    expect(await tasksOf(building.id)).toMatchObject([
      { status: "scheduled", dueDate: due, recurrenceMonths: 12 },
    ]);
  });

  it("says what to change about the title, and adds nothing", async () => {
    const { building } = await duplex();

    const result = await addTask({ ...oneOff(building.id), title: "   " });

    expect(result).toEqual({
      ok: false,
      errors: { title: "Enter what needs doing." },
    });
    expect(await tasksOf(building.id)).toEqual([]);
  });

  it("refuses a retired unit, another building's unit, and an archived building", async () => {
    const { org, building, c } = await duplex();
    const next = await createBuilding(org.id, { addressLine1: "18 E 10th St" });
    const theirs = await createUnit(org.id, next.id, { label: "A" });

    expect((await addTask(oneOff(building.id, c.id))).ok).toBe(false);
    expect((await addTask(oneOff(building.id, theirs.id))).ok).toBe(false);

    await testDb()
      .update(buildings)
      .set({ status: "archived" })
      .where(eq(buildings.id, next.id));
    expect((await addTask(oneOff(next.id))).ok).toBe(false);

    expect(await tasksOf(building.id)).toEqual([]);
    expect(await tasksOf(next.id)).toEqual([]);
  });

  it("refuses a frequency the list does not offer", async () => {
    const { building } = await duplex();

    const result = await addTask({ ...oneOff(building.id), recurrence: "7" });

    expect(result.ok).toBe(false);
    expect(await tasksOf(building.id)).toEqual([]);
  });
});

describe("completeTask", () => {
  it("marks a one-off done today, at its estimate", async () => {
    const { org, building } = await duplex();
    const task = await createTask(org.id, building.id, {
      recurrenceMonths: null,
      estCostCents: 42_500,
    });

    expect(await completeTask(task.id)).toEqual({
      ok: true,
      previousActualCostCents: null,
      next: null,
      expense: null,
    });
    expect(await tasksOf(building.id)).toMatchObject([
      { status: "done", completedOn: today, actualCostCents: 42_500 },
    ]);
  });

  it("keeps a cost already recorded rather than the estimate", async () => {
    const { org, building } = await duplex();
    const task = await createTask(org.id, building.id, {
      recurrenceMonths: null,
      estCostCents: 42_500,
      actualCostCents: 39_000,
    });

    expect(await completeTask(task.id)).toMatchObject({
      previousActualCostCents: 39_000,
    });
    expect((await tasksOf(building.id))[0]?.actualCostCents).toBe(39_000);
  });

  it("writes the next occurrence of a recurring task, and only that", async () => {
    const { org, owner, building, a } = await duplex();
    const task = await createTask(org.id, building.id, {
      unitId: a.id,
      notes: "Downspout on the north side clogs",
      tradeTag: "handyman",
      priority: "high",
      assigneeUserId: owner.id,
      confirmedOn: "2026-08-28",
      dueDate: "2026-09-01",
      recurrenceMonths: 3,
    });

    const result = await completeTask(task.id);
    const due = nextOccurrence({
      dueDate: "2026-09-01",
      completedOn: today,
      recurrenceMonths: 3,
    });

    expect(result).toMatchObject({ ok: true, next: { dueDate: due } });
    const [done, next] = await tasksOf(building.id);
    expect(done).toMatchObject({ id: task.id, status: "done" });
    // Not yet confirmed: the booking was for the occurrence just done.
    expect(next).toMatchObject({
      unitId: a.id,
      title: "Clean the gutters",
      notes: "Downspout on the north side clogs",
      tradeTag: "handyman",
      priority: "high",
      assigneeUserId: owner.id,
      confirmedOn: null,
      status: "scheduled",
      dueDate: due,
      estCostCents: 18_000,
      actualCostCents: null,
      completedOn: null,
      recurrenceMonths: 3,
      recurrenceParentId: task.id,
    });
  });

  it("refuses a second click, and a task on an archived building", async () => {
    const { org, building } = await duplex();
    const task = await createTask(org.id, building.id);

    expect((await completeTask(task.id)).ok).toBe(true);
    expect(await completeTask(task.id)).toEqual({ ok: false });
    // One next occurrence, not two.
    expect(await tasksOf(building.id)).toHaveLength(2);

    const archived = await createBuilding(org.id, { status: "archived" });
    const kept = await createTask(org.id, archived.id);
    expect(await completeTask(kept.id)).toEqual({ ok: false });
  });
});

describe("undoCompleteTask", () => {
  it("reopens the task with its cost as it was, and removes the next occurrence", async () => {
    const { org, building } = await duplex();
    const task = await createTask(org.id, building.id);
    const before = await tasksOf(building.id);

    const completed = await completeTask(task.id);
    if (!completed.ok) throw new Error("The completion was refused.");

    expect(
      await undoCompleteTask(task.id, completed.previousActualCostCents),
    ).toEqual({ ok: true });
    expect(await tasksOf(building.id)).toMatchObject([
      {
        id: task.id,
        status: before[0]!.status,
        dueDate: before[0]!.dueDate,
        completedOn: null,
        actualCostCents: null,
      },
    ]);
  });

  it("reopens a task with no date as unscheduled", async () => {
    const { org, building } = await duplex();
    const task = await createTask(org.id, building.id, {
      status: "unscheduled",
      dueDate: null,
      recurrenceMonths: null,
    });

    await completeTask(task.id);
    expect(await undoCompleteTask(task.id, null)).toEqual({ ok: true });
    expect((await tasksOf(building.id))[0]).toMatchObject({
      status: "unscheduled",
      completedOn: null,
    });
  });

  it("is refused once the next occurrence has been touched, and changes nothing", async () => {
    const { org, building, plumber } = await duplex();
    const task = await createTask(org.id, building.id, {
      assigneeContactId: plumber.id,
    });

    const completed = await completeTask(task.id);
    if (!completed.ok || !completed.next)
      throw new Error("No next occurrence.");
    // Booked with the plumber in the seconds since.
    expect(await setTaskConfirmation(completed.next.id, "today")).toMatchObject(
      { ok: true },
    );
    const touched = await tasksOf(building.id);

    expect(await undoCompleteTask(task.id, null)).toEqual({ ok: false });
    expect(await tasksOf(building.id)).toEqual(touched);
  });

  it("refuses a task that is not done", async () => {
    const { org, building } = await duplex();
    const task = await createTask(org.id, building.id);

    expect(await undoCompleteTask(task.id, null)).toEqual({ ok: false });
  });
});

describe("setTaskConfirmation", () => {
  it("records today, clears it, and puts back a date it had", async () => {
    const { org, building, plumber } = await duplex();
    const task = await createTask(org.id, building.id, {
      assigneeContactId: plumber.id,
    });
    const confirmedOn = async () =>
      (await tasksOf(building.id))[0]?.confirmedOn;

    expect(await setTaskConfirmation(task.id, "today")).toEqual({
      ok: true,
      confirmedOn: today,
    });
    expect(await confirmedOn()).toBe(today);

    expect(await setTaskConfirmation(task.id, null)).toEqual({
      ok: true,
      confirmedOn: null,
    });
    expect(await confirmedOn()).toBeNull();

    expect(await setTaskConfirmation(task.id, "2026-08-28")).toMatchObject({
      ok: true,
    });
    expect(await confirmedOn()).toBe("2026-08-28");
  });

  it("refuses an unassigned task, an unscheduled one, and a day still to come", async () => {
    const { org, building, plumber } = await duplex();
    const unassigned = await createTask(org.id, building.id);
    const unscheduled = await createTask(org.id, building.id, {
      status: "unscheduled",
      dueDate: null,
      assigneeContactId: plumber.id,
    });
    const booked = await createTask(org.id, building.id, {
      assigneeContactId: plumber.id,
    });

    expect(await setTaskConfirmation(unassigned.id, "today")).toEqual({
      ok: false,
    });
    expect(await setTaskConfirmation(unscheduled.id, "today")).toEqual({
      ok: false,
    });
    expect(
      await setTaskConfirmation(booked.id, addMonthsKeepingDay(today, 1)),
    ).toEqual({ ok: false });
    expect(
      (await tasksOf(building.id)).map((task) => task.confirmedOn),
    ).toEqual([null, null, null]);
  });
});

describe("the task reads", () => {
  it("name the assignee as a contact, Me, a member, or nobody", async () => {
    const { org, building, plumber } = await duplex();
    const colleague = await createUser();
    await createMembership(org.id, colleague.id);

    await createTask(org.id, building.id, {
      title: "Vendor",
      assigneeContactId: plumber.id,
    });
    await createTask(org.id, building.id, {
      title: "Colleague",
      assigneeUserId: colleague.id,
    });
    await createTask(org.id, building.id, { title: "Nobody" });

    const { tasks: rows } = await getMaintenanceInputs();
    const byTitle = Object.fromEntries(
      rows.map((row) => [row.title, row.assignee]),
    );

    expect(byTitle).toEqual({
      Vendor: { kind: "contact", name: "Dana Whitfield" },
      Colleague: { kind: "member" },
      Nobody: null,
    });
  });

  it("call the viewer's own task Me", async () => {
    const { org, owner, building } = await duplex();
    await createTask(org.id, building.id, { assigneeUserId: owner.id });

    const { tasks: rows } = await getMaintenanceInputs();

    expect(rows.map((row) => row.assignee)).toEqual([{ kind: "me" }]);
  });

  it("leave out cancelled tasks and archived buildings", async () => {
    const { org, building } = await duplex();
    const archived = await createBuilding(org.id, { status: "archived" });
    await createTask(org.id, building.id, { title: "Kept" });
    await createTask(org.id, building.id, {
      title: "Cancelled",
      status: "canceled",
    });
    await createTask(org.id, archived.id, { title: "Archived" });

    const inputs = await getMaintenanceInputs();

    expect(inputs.buildings.map((row) => row.id)).toEqual([building.id]);
    expect(inputs.buildings[0]?.units.map((unit) => unit.label)).toEqual([
      "A",
      "B",
    ]);
    expect(inputs.tasks.map((row) => row.title)).toEqual(["Kept"]);
  });

  it("give a building its open recurring tasks and its completions", async () => {
    const { org, building } = await duplex();
    await createTask(org.id, building.id, { title: "Gutters" });
    await createTask(org.id, building.id, {
      title: "One-off",
      recurrenceMonths: null,
    });
    await createTask(org.id, building.id, {
      title: "Gutters, last time",
      status: "done",
      completedOn: "2026-06-02",
    });

    const recurring = await getRecurringTasks(building.id);

    expect(recurring.open.map((row) => row.title)).toEqual(["Gutters"]);
    expect(recurring.open[0]?.addedOn).toBe(today);
    expect(recurring.done).toEqual([{ completedOn: "2026-06-02" }]);
  });
});

/** The task modal's form, filled in for gutters with nothing else chosen. */
function form(overrides: Partial<TaskFields> = {}): TaskFields {
  return {
    ...emptyTaskFields(null),
    title: "Clean the gutters",
    ...overrides,
  };
}

describe("createTask, from the task modal", () => {
  it("adds a booked task with the whole form, confirmed today", async () => {
    const { org, building, a, plumber } = await duplex();
    const item = await createCapitalItem(org.id, building.id, {
      unitId: a.id,
      typeSlug: "dishwasher",
      label: "Dishwasher",
    });

    const result = await saveNewTask(
      form({
        buildingId: building.id,
        scope: a.id,
        notes: "Leaks at the door seal",
        dueDate: "2026-10-01",
        assignee: plumber.id,
        confirmed: true,
        priority: "high",
        estCost: "$240",
        recurrence: "12",
        trade: "appliance-repair",
        equipment: item.id,
      }),
    );

    expect(result).toMatchObject({ ok: true });
    expect(await tasksOf(building.id)).toMatchObject([
      {
        unitId: a.id,
        capitalItemId: item.id,
        title: "Clean the gutters",
        notes: "Leaks at the door seal",
        tradeTag: "appliance-repair",
        status: "scheduled",
        priority: "high",
        dueDate: "2026-10-01",
        assigneeContactId: plumber.id,
        assigneeUserId: null,
        confirmedOn: today,
        estCostCents: 24_000,
        recurrenceMonths: 12,
      },
    ]);
  });

  it("leaves a task with no date unscheduled, and unconfirmed however the box was left", async () => {
    const { owner, building } = await duplex();

    await saveNewTask(
      form({ buildingId: building.id, assignee: ME, confirmed: true }),
    );

    expect(await tasksOf(building.id)).toMatchObject([
      {
        status: "unscheduled",
        dueDate: null,
        assigneeUserId: owner.id,
        confirmedOn: null,
      },
    ]);
  });

  it("refuses what the form names that is not there to name, and adds nothing", async () => {
    const { org, building, c } = await duplex();
    const archived = await createContact(org.id, { archivedAt: new Date() });
    const next = await createBuilding(org.id, { addressLine1: "18 E 10th St" });
    const elsewhere = await createCapitalItem(org.id, next.id);

    for (const overrides of [
      { assignee: archived.id },
      { assignee: MEMBER },
      { equipment: elsewhere.id },
      { trade: "not-a-trade" },
      { scope: c.id },
    ]) {
      const result = await saveNewTask(
        form({ buildingId: building.id, ...overrides }),
      );
      expect(result.ok).toBe(false);
    }

    expect(await tasksOf(building.id)).toEqual([]);
  });
});

describe("updateTask", () => {
  it("schedules a task given a date, and unschedules it when the date is cleared", async () => {
    const { org, building } = await duplex();
    const task = await createTask(org.id, building.id, {
      status: "unscheduled",
      dueDate: null,
    });

    await updateTask(task.id, form({ dueDate: "2026-11-02", recurrence: "3" }));
    expect((await tasksOf(building.id))[0]).toMatchObject({
      status: "scheduled",
      dueDate: "2026-11-02",
    });

    await updateTask(task.id, form({ recurrence: "3" }));
    expect((await tasksOf(building.id))[0]).toMatchObject({
      status: "unscheduled",
      dueDate: null,
    });
  });

  it("keeps a confirmation for the booking it was, and records today for a new one", async () => {
    const { org, building, plumber } = await duplex();
    const task = await createTask(org.id, building.id, {
      assigneeContactId: plumber.id,
      confirmedOn: "2026-08-28",
    });
    const booked = form({
      dueDate: "2026-09-01",
      assignee: plumber.id,
      confirmed: true,
      recurrence: "3",
    });
    const confirmedOn = async () =>
      (await tasksOf(building.id))[0]?.confirmedOn;

    await updateTask(task.id, { ...booked, notes: "Bring the long ladder" });
    expect(await confirmedOn()).toBe("2026-08-28");

    await updateTask(task.id, { ...booked, dueDate: "2026-09-08" });
    expect(await confirmedOn()).toBe(today);

    // Confirmed today, rebooked, and confirmed again in the same save: the
    // value written is the one it had, which the trigger alone would clear.
    await updateTask(task.id, { ...booked, dueDate: "2026-09-15" });
    expect(await confirmedOn()).toBe(today);

    await updateTask(task.id, {
      ...booked,
      dueDate: "2026-09-22",
      confirmed: false,
    });
    expect(await confirmedOn()).toBeNull();
  });

  it("keeps an archived contact or another member the task already has", async () => {
    const { org, building } = await duplex();
    const retired = await createContact(org.id, { archivedAt: new Date() });
    const colleague = await createUser();
    await createMembership(org.id, colleague.id);
    const withContact = await createTask(org.id, building.id, {
      assigneeContactId: retired.id,
    });
    const withMember = await createTask(org.id, building.id, {
      assigneeUserId: colleague.id,
    });
    const unassigned = await createTask(org.id, building.id);

    const keep = form({ dueDate: "2026-09-01", recurrence: "3" });
    expect(
      await updateTask(withContact.id, { ...keep, assignee: retired.id }),
    ).toMatchObject({ ok: true });
    expect(
      await updateTask(withMember.id, { ...keep, assignee: MEMBER }),
    ).toMatchObject({ ok: true });
    // Neither can be chosen for a task that does not have them.
    expect(
      (await updateTask(unassigned.id, { ...keep, assignee: retired.id })).ok,
    ).toBe(false);
    expect(
      (await updateTask(unassigned.id, { ...keep, assignee: MEMBER })).ok,
    ).toBe(false);

    expect(
      (await tasksOf(building.id)).map((row) => [
        row.assigneeContactId,
        row.assigneeUserId,
      ]),
    ).toEqual([
      [retired.id, null],
      [null, colleague.id],
      [null, null],
    ]);
  });

  it("saves a done task's completion and cost, and keeps it done", async () => {
    const { org, building } = await duplex();
    const task = await createTask(org.id, building.id, {
      status: "done",
      completedOn: "2026-09-02",
      actualCostCents: 18_000,
    });

    expect(
      await updateTask(
        task.id,
        form({ completedOn: "2026-09-03", actualCost: "212.50" }),
      ),
    ).toMatchObject({ ok: true });
    expect((await tasksOf(building.id))[0]).toMatchObject({
      status: "done",
      dueDate: "2026-09-01",
      recurrenceMonths: 3,
      completedOn: "2026-09-03",
      actualCostCents: 21_250,
    });

    expect(
      await updateTask(
        task.id,
        form({ completedOn: addMonthsKeepingDay(today, 1) }),
      ),
    ).toEqual({
      ok: false,
      errors: { completedOn: "Enter today’s date or an earlier one." },
    });
  });

  it("refuses a cancelled task and one on an archived building", async () => {
    const { org, building } = await duplex();
    const cancelled = await createTask(org.id, building.id, {
      status: "canceled",
    });
    const archived = await createBuilding(org.id, { status: "archived" });
    const kept = await createTask(org.id, archived.id);

    for (const task of [cancelled, kept]) {
      expect((await updateTask(task.id, form({ title: "Renamed" }))).ok).toBe(
        false,
      );
    }
    expect((await tasksOf(building.id))[0]?.title).toBe("Clean the gutters");
  });
});

describe("completeTask, from Mark done", () => {
  it("records the day and cost given, and counts the next occurrence from that day", async () => {
    const { org, building } = await duplex();
    const task = await createTask(org.id, building.id, {
      dueDate: "2026-06-01",
    });

    const result = await completeTask(task.id, {
      completedOn: "2026-06-20",
      cost: "",
    });

    expect(result).toMatchObject({
      ok: true,
      next: { dueDate: "2026-09-01" },
    });
    expect((await tasksOf(building.id))[0]).toMatchObject({
      status: "done",
      completedOn: "2026-06-20",
      actualCostCents: null,
    });
  });

  it("says what to change, and completes nothing", async () => {
    const { org, building } = await duplex();
    const task = await createTask(org.id, building.id);

    expect(
      await completeTask(task.id, {
        completedOn: addMonthsKeepingDay(today, 1),
        cost: "180",
      }),
    ).toEqual({
      ok: false,
      errors: { completedOn: "Enter today’s date or an earlier one." },
    });
    expect(await tasksOf(building.id)).toMatchObject([{ status: "scheduled" }]);
  });
});

describe("completeTask, recording an expense", () => {
  async function expensesOf(taskId: string) {
    return await testDb()
      .select()
      .from(transactions)
      .where(eq(transactions.taskId, taskId));
  }

  it("writes the job's bill, linked, filed by its trade, when asked", async () => {
    const { org, building, a, plumber } = await duplex();
    const task = await createTask(org.id, building.id, {
      unitId: a.id,
      tradeTag: "plumber",
      assigneeContactId: plumber.id,
      recurrenceMonths: null,
    });

    const result = await completeTask(task.id, {
      completedOn: "2026-06-20",
      cost: "182.50",
      recordExpense: true,
    });

    expect(result).toMatchObject({
      ok: true,
      expense: { amountCents: -18_250 },
    });
    expect(await expensesOf(task.id)).toMatchObject([
      {
        orgId: org.id,
        buildingId: building.id,
        unitId: a.id,
        contactId: plumber.id,
        occurredOn: "2026-06-20",
        amountCents: -18_250,
        description: "Clean the gutters",
        scheduleECategory: "repairs",
        classification: "unclassified",
      },
    ]);
  });

  it("writes none unticked, for no cost, or from the one-click checkbox", async () => {
    const { org, building } = await duplex();
    const unticked = await createTask(org.id, building.id);
    const free = await createTask(org.id, building.id);
    const oneClick = await createTask(org.id, building.id);

    await completeTask(unticked.id, { completedOn: "2026-06-20", cost: "180" });
    await completeTask(free.id, {
      completedOn: "2026-06-20",
      cost: "",
      recordExpense: true,
    });
    await completeTask(oneClick.id);

    expect(await testDb().select().from(transactions)).toEqual([]);
  });

  it("takes the expense back on Undo, and refuses the Undo once it was edited", async () => {
    const { org, building } = await duplex();
    const task = await createTask(org.id, building.id, {
      recurrenceMonths: null,
    });
    const completion = {
      completedOn: "2026-06-20",
      cost: "180",
      recordExpense: true,
    };

    const first = await completeTask(task.id, completion);
    if (!first.ok || !first.expense) throw new Error("No expense written.");
    expect(await undoCompleteTask(task.id, null, first.expense.id)).toEqual({
      ok: true,
    });
    expect(await expensesOf(task.id)).toEqual([]);

    const second = await completeTask(task.id, completion);
    if (!second.ok || !second.expense) throw new Error("No expense written.");
    await testDb()
      .update(transactions)
      .set({ description: "Gutters, and a downspout" })
      .where(eq(transactions.id, second.expense.id));

    expect(await undoCompleteTask(task.id, null, second.expense.id)).toEqual({
      ok: false,
    });
    expect(await tasksOf(building.id)).toMatchObject([{ status: "done" }]);
    expect(await expensesOf(task.id)).toHaveLength(1);

    // Moved to another building, which unlinks it from the task, is edited
    // too — and found by its id, so the Undo is still refused.
    const other = await createBuilding(org.id);
    await testDb()
      .update(transactions)
      .set({ buildingId: other.id, taskId: null })
      .where(eq(transactions.id, second.expense.id));
    expect(await undoCompleteTask(task.id, null, second.expense.id)).toEqual({
      ok: false,
    });
    expect(await tasksOf(building.id)).toMatchObject([{ status: "done" }]);
  });
});

describe("cancelTask", () => {
  it("cancels an open task with its confirmation, and writes no next occurrence", async () => {
    const { org, building, plumber } = await duplex();
    const task = await createTask(org.id, building.id, {
      assigneeContactId: plumber.id,
      confirmedOn: "2026-08-28",
    });

    expect(await cancelTask(task.id)).toEqual({ ok: true });
    expect(await tasksOf(building.id)).toMatchObject([
      { status: "canceled", confirmedOn: null },
    ]);
    expect(await cancelTask(task.id)).toEqual({ ok: false });
  });

  it("refuses a done task", async () => {
    const { org, building } = await duplex();
    const task = await createTask(org.id, building.id, {
      status: "done",
      completedOn: "2026-09-02",
    });

    expect(await cancelTask(task.id)).toEqual({ ok: false });
    expect((await tasksOf(building.id))[0]?.status).toBe("done");
  });
});

describe("getTaskModal", () => {
  it("opens nothing without the param, and not-found for an id that is not a task", async () => {
    await duplex();

    expect(await getTaskModal(null, null)).toBeNull();
    expect(await getTaskModal("not-an-id", null)).toEqual({
      kind: "not-found",
    });
    expect(
      await getTaskModal("0199a8a0-0000-7000-8000-000000000009", null),
    ).toEqual({ kind: "not-found" });
  });

  it("offers a new task the active buildings, starting on the page's", async () => {
    const { org, building } = await duplex();
    await createBuilding(org.id, { status: "archived" });

    const modal = await getTaskModal("new", building.id);

    expect(modal).toMatchObject({ kind: "new", buildingId: building.id });
    if (modal?.kind !== "new") throw new Error("Not a new task.");
    expect(modal.buildings.map((row) => row.id)).toEqual([building.id]);
  });

  it("opens a task with its building's equipment, keeping an item no longer in service", async () => {
    const { org, owner, building } = await duplex();
    const furnace = await createCapitalItem(org.id, building.id);
    const gone = await createCapitalItem(org.id, building.id, {
      typeSlug: "dishwasher",
      label: "Dishwasher",
      status: "removed",
    });
    await createCapitalItem(org.id, building.id, {
      typeSlug: "refrigerator",
      label: "Refrigerator",
      status: "removed",
    });
    const task = await createTask(org.id, building.id, {
      capitalItemId: gone.id,
      assigneeUserId: owner.id,
    });

    const modal = await getTaskModal(task.id, null);

    if (modal?.kind !== "edit") throw new Error("Not an existing task.");
    expect(modal.readOnly).toBe(false);
    expect(modal.task).toMatchObject({ id: task.id, assigneeKind: "me" });
    expect(modal.building.equipment).toEqual([
      { id: gone.id, label: "Dishwasher", unitId: null, inService: false },
      { id: furnace.id, label: "Gas furnace", unitId: null, inService: true },
    ]);
  });

  it("opens a cancelled task, and one on an archived building, read-only", async () => {
    const { org, building } = await duplex();
    const cancelled = await createTask(org.id, building.id, {
      status: "canceled",
    });
    const archived = await createBuilding(org.id, { status: "archived" });
    const kept = await createTask(org.id, archived.id);

    for (const task of [cancelled, kept]) {
      expect(await getTaskModal(task.id, null)).toMatchObject({
        kind: "edit",
        readOnly: true,
      });
    }
  });
});
