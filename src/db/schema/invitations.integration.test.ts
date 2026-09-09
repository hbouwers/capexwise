/**
 * `invitations`. The table ships with the tenancy spine because Better Auth's
 * `organization` plugin expects it to exist; the flow that fills it is #30.
 *
 * The two things worth checking now are the two that would otherwise be found
 * by #30: that the `status` check constraint actually holds the set down to
 * four values, and that `inviter_id` is `restrict` rather than `cascade` — the
 * one foreign key in this migration that differs from the others, and so the
 * one most likely to have been written on autopilot.
 */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { invitations, organizations, users } from "@/db/schema";
import { testDb } from "@/test/db";
import {
  createInvitation,
  createOrganization,
  createUser,
} from "@/test/factories";
import {
  CHECK_VIOLATION,
  rejectsWith,
  RESTRICT_VIOLATION,
} from "@/test/postgres-errors";

describe("invitations", () => {
  describe("defaults", () => {
    it("starts an invitation pending, offering the member role", async () => {
      const org = await createOrganization();
      const inviter = await createUser();

      const invitation = await createInvitation(org.id, inviter.id);

      expect(invitation.status).toBe("pending");
      expect(invitation.role).toBe("member");
    });
  });

  describe("the status check", () => {
    it("accepts each of the four known states", async () => {
      const org = await createOrganization();
      const inviter = await createUser();

      for (const status of [
        "pending",
        "accepted",
        "canceled",
        "expired",
      ] as const) {
        const invitation = await createInvitation(org.id, inviter.id, {
          status,
        });

        expect(invitation.status).toBe(status);
      }
    });

    it("refuses a status outside that set", async () => {
      // `status` is `text` rather than a native enum because the values are
      // Better Auth's to change (`docs/data-model.md` §2). The check constraint
      // is what stops that flexibility becoming a column of free text with
      // "cancelled" and "canceled" both in it.
      const org = await createOrganization();
      const inviter = await createUser();

      await expect(
        createInvitation(org.id, inviter.id, { status: "cancelled" }),
      ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
    });
  });

  describe("deletion", () => {
    it("refuses to delete a user who has invited someone", async () => {
      // `restrict`, and the only foreign key in `0002` that is. §7: a `users`
      // row survives as long as anything references it. Losing the invitation
      // would be the small harm; losing who sent it while it still stands is
      // the real one, and an outstanding invitation with no inviter is a row
      // nobody can explain.
      const org = await createOrganization();
      const inviter = await createUser();
      await createInvitation(org.id, inviter.id);

      await expect(
        testDb().delete(users).where(eq(users.id, inviter.id)),
      ).rejects.toSatisfy(rejectsWith(RESTRICT_VIOLATION));

      expect(await testDb().select().from(users)).toHaveLength(1);
    });

    it("takes invitations with the organization", async () => {
      const org = await createOrganization();
      const inviter = await createUser();
      await createInvitation(org.id, inviter.id);

      await testDb().delete(organizations).where(eq(organizations.id, org.id));

      expect(await testDb().select().from(invitations)).toHaveLength(0);
    });
  });

  describe("the updated_at trigger", () => {
    it("is attached to this table", async () => {
      const LONG_AGO = new Date("2020-01-01T00:00:00.000Z");
      const org = await createOrganization();
      const inviter = await createUser();
      const invitation = await createInvitation(org.id, inviter.id, {
        updatedAt: LONG_AGO,
      });

      await testDb()
        .update(invitations)
        .set({ status: "accepted" })
        .where(eq(invitations.id, invitation.id));

      const [after] = await testDb()
        .select()
        .from(invitations)
        .where(eq(invitations.id, invitation.id));

      expect(after?.updatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
    });
  });
});
