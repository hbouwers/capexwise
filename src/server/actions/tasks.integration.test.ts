/**
 * What the task writes do inside one org: the two add rows, a completion that
 * writes the next occurrence and an Undo that takes it back only while nobody
 * has touched it, and the confirmation toggle. The reads' assignees and
 * filters are here too. The cross-org half is the isolation test's.
 *
 * Driven as the pages drive them — a signed session, then the function — as
 * `capital-items.integration.test.ts` does, whose session setup this repeats.
 */
import { makeSignature } from "better-auth/crypto";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { buildings, tasks } from "@/db/schema";
import { addMonthsKeepingDay, todayIn } from "@/lib/dates";
import { nextOccurrence } from "@/lib/tasks";
import { applicationDatabaseUrl, testDb } from "@/test/db";
import {
  createBuilding,
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
const { addTask, completeTask, setTaskConfirmation, undoCompleteTask } =
  await import("@/server/actions/tasks");
const { getMaintenanceInputs, getRecurringTasks } =
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
