/**
 * The parts of `tasks` that live in SQL: the checks that keep a status and its
 * dates agreeing, a confirmation that means somebody was booked for a day, the
 * trigger that clears one when the day or the somebody changes (#93), a member
 * as an assignee (#94), and what a delete elsewhere does to a task.
 * `npm run typecheck` sees none of them, and each is a claim
 * `docs/data-model.md` §6 and §7 make in prose.
 *
 * Completing a task and writing its next occurrence belong to the action that
 * does it, and are tested beside it.
 */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { capitalItems, contacts, memberships, tasks } from "@/db/schema";
import { testDb } from "@/test/db";
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
import {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  rejectsWith,
  RESTRICT_VIOLATION,
} from "@/test/postgres-errors";

async function world() {
  const org = await createOrganization();
  const building = await createBuilding(org.id);
  const contact = await createContact(org.id, { name: "Dana Whitfield" });

  return { org, building, contact };
}

async function reread(id: string) {
  const [row] = await testDb().select().from(tasks).where(eq(tasks.id, id));
  return row!;
}

describe("tasks", () => {
  it("starts unscheduled, at normal priority, unconfirmed", async () => {
    const { org, building } = await world();

    const task = await createTask(org.id, building.id, {
      status: undefined,
      dueDate: null,
    });

    expect(task).toMatchObject({
      status: "unscheduled",
      priority: "normal",
      unitId: null,
      confirmedOn: null,
      assigneeContactId: null,
      assigneeUserId: null,
    });
  });

  it("refuses a scheduled task with no date, and a done one with no completion", async () => {
    const { org, building } = await world();

    await expect(
      createTask(org.id, building.id, { status: "scheduled", dueDate: null }),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
    await expect(
      createTask(org.id, building.id, { status: "done", completedOn: null }),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
  });

  it("refuses a vendor and a member on one task", async () => {
    const { org, building, contact } = await world();
    const owner = await createUser();
    await createMembership(org.id, owner.id, { role: "owner" });

    await expect(
      createTask(org.id, building.id, {
        assigneeContactId: contact.id,
        assigneeUserId: owner.id,
      }),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
  });

  it("assigns only a member of the task's own org", async () => {
    // The user exists, and is a member — of another org. The reference is to
    // the membership, so it is refused.
    const { org, building } = await world();
    const elsewhere = await createOrganization();
    const outsider = await createUser();
    await createMembership(elsewhere.id, outsider.id);

    await expect(
      createTask(org.id, building.id, { assigneeUserId: outsider.id }),
    ).rejects.toSatisfy(rejectsWith(FOREIGN_KEY_VIOLATION));
  });

  it("confirms only a scheduled or done task that has an assignee", async () => {
    const { org, building, contact } = await world();

    // Nobody to have booked.
    await expect(
      createTask(org.id, building.id, { confirmedOn: "2026-08-28" }),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
    // No day to book.
    await expect(
      createTask(org.id, building.id, {
        status: "unscheduled",
        dueDate: null,
        assigneeContactId: contact.id,
        confirmedOn: "2026-08-28",
      }),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));

    const booked = await createTask(org.id, building.id, {
      assigneeContactId: contact.id,
      confirmedOn: "2026-08-28",
    });
    // Done keeps the confirmation, as history.
    await testDb()
      .update(tasks)
      .set({ status: "done", completedOn: "2026-09-01" })
      .where(eq(tasks.id, booked.id));
    expect((await reread(booked.id)).confirmedOn).toBe("2026-08-28");

    // Cancelled does not: the booking is off, and saying so is the writer's job.
    const cancelled = await createTask(org.id, building.id, {
      assigneeContactId: contact.id,
      confirmedOn: "2026-08-28",
    });
    await expect(
      testDb()
        .update(tasks)
        .set({ status: "canceled" })
        .where(eq(tasks.id, cancelled.id)),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
  });

  it("clears a confirmation when the date or the assignee changes", async () => {
    const { org, building, contact } = await world();
    const other = await createContact(org.id, { name: "Rob Lindqvist" });
    const confirmed = {
      assigneeContactId: contact.id,
      confirmedOn: "2026-08-28",
    };

    const moved = await createTask(org.id, building.id, confirmed);
    await testDb()
      .update(tasks)
      .set({ dueDate: "2026-09-08" })
      .where(eq(tasks.id, moved.id));
    expect((await reread(moved.id)).confirmedOn).toBeNull();

    const reassigned = await createTask(org.id, building.id, confirmed);
    await testDb()
      .update(tasks)
      .set({ assigneeContactId: other.id })
      .where(eq(tasks.id, reassigned.id));
    expect((await reread(reassigned.id)).confirmedOn).toBeNull();

    // Unassigning clears it rather than being refused for leaving it behind.
    const unassigned = await createTask(org.id, building.id, confirmed);
    await testDb()
      .update(tasks)
      .set({ assigneeContactId: null })
      .where(eq(tasks.id, unassigned.id));
    expect((await reread(unassigned.id)).confirmedOn).toBeNull();
  });

  it("keeps a confirmation through any other change, and one set with the new day", async () => {
    const { org, building, contact } = await world();

    const noted = await createTask(org.id, building.id, {
      assigneeContactId: contact.id,
      confirmedOn: "2026-08-28",
    });
    await testDb()
      .update(tasks)
      .set({ notes: "Bring the long ladder", estCostCents: 21_000 })
      .where(eq(tasks.id, noted.id));
    expect((await reread(noted.id)).confirmedOn).toBe("2026-08-28");

    // The modal saving a new day and confirming it in one statement.
    await testDb()
      .update(tasks)
      .set({ dueDate: "2026-09-08", confirmedOn: "2026-09-02" })
      .where(eq(tasks.id, noted.id));
    expect((await reread(noted.id)).confirmedOn).toBe("2026-09-02");
  });

  it("unassigns, and unconfirms, when the member leaves or the vendor is deleted", async () => {
    const { org, building, contact } = await world();
    const member = await createUser();
    const membership = await createMembership(org.id, member.id);

    const theirs = await createTask(org.id, building.id, {
      assigneeUserId: member.id,
      confirmedOn: "2026-08-28",
    });
    const vendors = await createTask(org.id, building.id, {
      assigneeContactId: contact.id,
      confirmedOn: "2026-08-28",
    });

    await testDb().delete(memberships).where(eq(memberships.id, membership.id));
    await testDb().delete(contacts).where(eq(contacts.id, contact.id));

    for (const id of [theirs.id, vendors.id]) {
      // The task, its org and its building stay: only the one column is null.
      expect(await reread(id)).toMatchObject({
        orgId: org.id,
        buildingId: building.id,
        assigneeUserId: null,
        assigneeContactId: null,
        confirmedOn: null,
      });
    }
  });

  it("loses only the link when its equipment is deleted", async () => {
    const { org, building } = await world();
    const item = await createCapitalItem(org.id, building.id);
    const task = await createTask(org.id, building.id, {
      capitalItemId: item.id,
    });

    await testDb().delete(capitalItems).where(eq(capitalItems.id, item.id));

    expect(await reread(task.id)).toMatchObject({
      orgId: org.id,
      buildingId: building.id,
      capitalItemId: null,
    });
  });

  it("refuses equipment, a unit or a parent from another building", async () => {
    const { org, building } = await world();
    const next = await createBuilding(org.id, { addressLine1: "18 E 10th St" });
    const item = await createCapitalItem(org.id, next.id);
    const unit = await createUnit(org.id, next.id, { label: "A" });
    const parent = await createTask(org.id, next.id);

    for (const overrides of [
      { capitalItemId: item.id },
      { unitId: unit.id },
      { recurrenceParentId: parent.id },
    ]) {
      await expect(
        createTask(org.id, building.id, overrides),
      ).rejects.toSatisfy(rejectsWith(FOREIGN_KEY_VIOLATION));
    }
  });

  it("holds its building and its unit in place", async () => {
    const { org, building } = await world();
    const unit = await createUnit(org.id, building.id, { label: "A" });
    await createTask(org.id, building.id, { unitId: unit.id });

    await expect(
      testDb().execute(`delete from units where id = '${unit.id}'`),
    ).rejects.toSatisfy(rejectsWith(RESTRICT_VIOLATION));
    await expect(
      testDb().execute(`delete from buildings where id = '${building.id}'`),
    ).rejects.toSatisfy(rejectsWith(RESTRICT_VIOLATION));
  });
});
