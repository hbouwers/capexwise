/**
 * `memberships` — the table that decides who may act inside which org, and so
 * the one whose SQL is worth the most scrutiny.
 *
 * Three things here are claims nothing else checks: that one person can hold
 * memberships in several orgs (the assumption the whole product is built to
 * avoid making the other way round), that the composite unique stops the same
 * person being added twice, and that both foreign keys cascade the way §7 says.
 *
 * **Not covered here, on purpose: "an org must always have at least one
 * owner."** `docs/data-model.md` §2 records that it is not expressible as a
 * constraint without a trigger and is enforced in the application at the two
 * places that can break it — revoking a membership, and changing a role.
 * Neither of those exists yet (#29, #30 own them). A test written now would
 * assert against nothing; the rule is named here so it is picked up with the
 * code rather than rediscovered when an org locks itself out.
 */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { memberships, organizations, users } from "@/db/schema";
import { testDb } from "@/test/db";
import {
  createMembership,
  createOrganization,
  createUser,
} from "@/test/factories";
import {
  FOREIGN_KEY_VIOLATION,
  rejectsWith,
  UNIQUE_VIOLATION,
} from "@/test/postgres-errors";

describe("memberships", () => {
  describe("defaults", () => {
    it("starts a membership as a member, not an owner", async () => {
      // The safe default of the two. A membership row created without a role
      // being thought about should be the one that cannot remove other people.
      const org = await createOrganization();
      const user = await createUser();

      const membership = await createMembership(org.id, user.id);

      expect(membership.role).toBe("member");
    });

    it("accepts both roles", async () => {
      const org = await createOrganization();

      for (const role of ["member", "owner"] as const) {
        const user = await createUser();
        const membership = await createMembership(org.id, user.id, { role });

        expect(membership.role).toBe(role);
      }
    });
  });

  describe("one person, several orgs", () => {
    it("lets a user belong to more than one organization", async () => {
      // The assumption the schema exists to prevent anyone making: one org per
      // user. In practice Holden holds three at once — his own, the demo org,
      // and any customer he is helping — and a unique on `user_id` alone would
      // have looked correct right up until the demo org was seeded.
      const personal = await createOrganization({ slug: "personal" });
      const demo = await createOrganization({ slug: "demo", isDemo: true });
      const user = await createUser();

      await createMembership(personal.id, user.id, { role: "owner" });
      await createMembership(demo.id, user.id);

      const rows = await testDb()
        .select()
        .from(memberships)
        .where(eq(memberships.userId, user.id));

      expect(rows).toHaveLength(2);
    });

    it("lets an organization hold more than one user", async () => {
      const org = await createOrganization();

      await createMembership(org.id, (await createUser()).id, {
        role: "owner",
      });
      await createMembership(org.id, (await createUser()).id);

      const rows = await testDb()
        .select()
        .from(memberships)
        .where(eq(memberships.orgId, org.id));

      expect(rows).toHaveLength(2);
    });

    it("refuses the same person in the same organization twice", async () => {
      const org = await createOrganization();
      const user = await createUser();

      await createMembership(org.id, user.id);

      await expect(createMembership(org.id, user.id)).rejects.toSatisfy(
        rejectsWith(UNIQUE_VIOLATION),
      );
    });

    it("refuses a duplicate even when the role differs", async () => {
      // The unique is on `(org_id, user_id)` and not on the role. Without that,
      // a role change written as an insert would leave a person holding two
      // memberships in one org, and which one a permission check reads would
      // depend on row order.
      const org = await createOrganization();
      const user = await createUser();

      await createMembership(org.id, user.id, { role: "member" });

      await expect(
        createMembership(org.id, user.id, { role: "owner" }),
      ).rejects.toSatisfy(rejectsWith(UNIQUE_VIOLATION));
    });
  });

  describe("both sides are real foreign keys", () => {
    // `org_id uuid` and `org_id uuid references organizations (id)` are
    // indistinguishable in TypeScript, in a query, and in review. The
    // difference only shows up as a rejected write, which makes it the kind of
    // claim that has to be checked in the database or not at all — and on the
    // table the whole security model joins against, an `org_id` that is merely
    // a uuid-shaped column is the worst version of this schema to ship.
    const NOT_A_ROW = "00000000-0000-7000-8000-000000000000";

    it("refuses a membership in an organization that does not exist", async () => {
      const user = await createUser();

      await expect(createMembership(NOT_A_ROW, user.id)).rejects.toSatisfy(
        rejectsWith(FOREIGN_KEY_VIOLATION),
      );
    });

    it("refuses a membership for a user who does not exist", async () => {
      const org = await createOrganization();

      await expect(createMembership(org.id, NOT_A_ROW)).rejects.toSatisfy(
        rejectsWith(FOREIGN_KEY_VIOLATION),
      );
    });
  });

  describe("deletion", () => {
    it("takes memberships with the organization", async () => {
      // §7: the org purge job hard-deletes 30 days after `deleted_at` is set,
      // and it cascades. A membership to an org that no longer exists is not a
      // fact worth keeping, and a `restrict` here would stall the purge.
      const org = await createOrganization();
      const user = await createUser();
      await createMembership(org.id, user.id, { role: "owner" });

      await testDb().delete(organizations).where(eq(organizations.id, org.id));

      expect(await testDb().select().from(memberships)).toHaveLength(0);
      // The user outlives the org. Identity is above the tenancy boundary, so
      // deleting an org must not delete the people who were in it.
      expect(await testDb().select().from(users)).toHaveLength(1);
    });

    it("takes memberships with the user", async () => {
      // §7: account deletion revokes memberships. It does not erase authorship —
      // the references that outlive a user (`invitations.inviter_id`, and #42's
      // audit log) are `restrict`, and this one is not one of them.
      const org = await createOrganization();
      const user = await createUser();
      await createMembership(org.id, user.id);

      await testDb().delete(users).where(eq(users.id, user.id));

      expect(await testDb().select().from(memberships)).toHaveLength(0);
      expect(await testDb().select().from(organizations)).toHaveLength(1);
    });
  });

  describe("the updated_at trigger", () => {
    it("is attached to this table", async () => {
      const LONG_AGO = new Date("2020-01-01T00:00:00.000Z");
      const org = await createOrganization();
      const user = await createUser();
      const membership = await createMembership(org.id, user.id, {
        updatedAt: LONG_AGO,
      });

      await testDb()
        .update(memberships)
        .set({ role: "owner" })
        .where(eq(memberships.id, membership.id));

      const [after] = await testDb()
        .select()
        .from(memberships)
        .where(eq(memberships.id, membership.id));

      expect(after?.updatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
    });
  });
});
