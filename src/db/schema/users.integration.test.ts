/**
 * `users`, and the claims about it that live in SQL rather than in TypeScript.
 *
 * Deliberately narrow. `organizations.integration.test.ts` already covers the
 * `uuidv7()` default and the three semantics of the `set_updated_at()` trigger
 * at length, and repeating them per table would be nine tests that all fail
 * together for one reason. What is new here is what only this table can get
 * wrong: its unique index, and whether `drizzle/0003` actually attached the
 * trigger to it — a hand-written migration that forgets one table is the exact
 * mistake that file invites.
 */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { users } from "@/db/schema";
import { testDb } from "@/test/db";
import { createUser } from "@/test/factories";
import { rejectsWith, UNIQUE_VIOLATION } from "@/test/postgres-errors";

describe("users", () => {
  describe("defaults", () => {
    it("starts a user unverified, with a generated v7 id", async () => {
      const user = await createUser();

      expect(user.emailVerified).toBe(false);
      expect(user.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it("accepts a user with no name and no image", async () => {
      // Both are nullable because what an OAuth provider returns about a person
      // is its choice, not ours. A `not null` here would make a sign-in fail on
      // a Google account with no picture set.
      const user = await createUser({ name: null, image: null });

      expect(user.name).toBeNull();
      expect(user.image).toBeNull();
    });
  });

  describe("uniqueness", () => {
    it("refuses a second user with the same email", async () => {
      await createUser({ email: "holden@example.test" });

      await expect(
        createUser({ email: "holden@example.test" }),
      ).rejects.toSatisfy(rejectsWith(UNIQUE_VIOLATION));
    });

    it("treats a differently-cased email as a different user", async () => {
      // Not the behaviour anyone wants long-term, and it is asserted rather than
      // left to be discovered. The unique index is on the value as stored, so
      // case folding has to happen wherever the row is created — see the comment
      // on `users.email`. This test is what will fail, loudly and in the right
      // place, when a second auth provider makes that a real problem.
      await createUser({ email: "holden@example.test" });
      const second = await createUser({ email: "Holden@example.test" });

      expect(second.email).toBe("Holden@example.test");
    });
  });

  describe("the updated_at trigger", () => {
    it("is attached to this table", async () => {
      // `drizzle/0003` creates one trigger per table by hand. The failure it
      // invites is a table left out of it, which nothing else would notice:
      // `updated_at` would simply keep its insert value forever.
      const LONG_AGO = new Date("2020-01-01T00:00:00.000Z");
      const user = await createUser({ updatedAt: LONG_AGO });

      await testDb()
        .update(users)
        .set({ emailVerified: true })
        .where(eq(users.id, user.id));

      const [after] = await testDb()
        .select()
        .from(users)
        .where(eq(users.id, user.id));

      expect(after?.updatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
    });
  });
});
