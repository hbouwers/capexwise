/**
 * The first database-backed test, and the one that proves the harness works: it
 * needs the test database to exist, the committed migrations to have been
 * applied to it, and truncation to be running between tests.
 *
 * What it asserts is the part of the schema that lives in SQL rather than in
 * TypeScript, which is exactly the part `npm run typecheck` cannot see. The
 * `uuidv7()` default, the partial unique index and the `updated_at` trigger are
 * three claims made in comments in `src/db/schema/organizations.ts` and
 * `drizzle/0001_updated_at_trigger.sql`; until now nothing checked that the
 * database agreed with them.
 */
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { organizations } from "@/db/schema";
import { testDb } from "@/test/db";
import { createOrganization } from "@/test/factories";
import { rejectsWith, UNIQUE_VIOLATION } from "@/test/postgres-errors";

describe("organizations", () => {
  describe("the harness itself", () => {
    // Two tests that would both pass if truncation silently did nothing, and
    // cannot both pass unless it works: each inserts one row and insists it is
    // alone. If they ever fail together, suspect `truncateAll` before the schema.
    it("starts from an empty table", async () => {
      await createOrganization();

      const rows = await testDb().select().from(organizations);

      expect(rows).toHaveLength(1);
    });

    it("starts from an empty table for the next test too", async () => {
      await createOrganization();

      const rows = await testDb().select().from(organizations);

      expect(rows).toHaveLength(1);
    });
  });

  describe("identifiers", () => {
    it("defaults the id to a v7 UUID", async () => {
      // ADR-0005: sequential ids on a multi-tenant product leak portfolio size
      // to anyone who can read a URL. The default is in the database rather than
      // in the application so a row inserted by a migration or by psql is as
      // well-formed as one from a Server Action — which means this is the only
      // place it can be checked.
      const organization = await createOrganization();

      expect(organization.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it("gives two rows different ids", async () => {
      const first = await createOrganization();
      const second = await createOrganization();

      expect(first.id).not.toBe(second.id);
    });
  });

  describe("defaults", () => {
    it("starts an organization on the free plan, not a demo, not deleted", async () => {
      const organization = await createOrganization();

      expect(organization.plan).toBe("free");
      expect(organization.isDemo).toBe(false);
      expect(organization.deletedAt).toBeNull();
      expect(organization.createdAt).toBeInstanceOf(Date);
    });

    it("accepts each of the three plans", async () => {
      // Three values, not two: pricing separates *pays us* from *has the premium
      // features*, so `paid` sits between `free` and `premium`. A native enum
      // means a fourth spelling is a database error rather than a stored typo.
      for (const plan of ["free", "paid", "premium"] as const) {
        const organization = await createOrganization({
          slug: `plan-${plan}`,
          plan,
        });

        expect(organization.plan).toBe(plan);
      }
    });
  });

  describe("uniqueness", () => {
    it("refuses a duplicate slug", async () => {
      await createOrganization({ slug: "acme" });

      await expect(createOrganization({ slug: "acme" })).rejects.toSatisfy(
        rejectsWith(UNIQUE_VIOLATION),
      );
    });

    it("allows any number of organizations that are not the demo", async () => {
      // The half of the partial index that is easy to lose. A plain unique index
      // on `is_demo` would also reject this, and the failure would not show up
      // until the second real customer signed up.
      await createOrganization();
      await createOrganization();
      await createOrganization();

      const rows = await testDb().select().from(organizations);

      expect(rows).toHaveLength(3);
    });

    it("refuses a second demo organization", async () => {
      await createOrganization({ slug: "demo", isDemo: true });

      await expect(
        createOrganization({ slug: "demo-two", isDemo: true }),
      ).rejects.toSatisfy(rejectsWith(UNIQUE_VIOLATION));
    });
  });

  describe("the updated_at trigger", () => {
    // Both tests below insert with `updated_at` set to a fixed date in the past
    // rather than letting it default and then comparing timestamps taken moments
    // apart. `now()` is transaction start time and JavaScript `Date` resolves to
    // the millisecond, so two quick statements can genuinely share a value —
    // a comparison between them is a test that fails once a fortnight on a fast
    // machine. A date in 2020 cannot tie with one from today.
    const LONG_AGO = new Date("2020-01-01T00:00:00.000Z");

    it("moves updated_at when a column actually changes", async () => {
      const organization = await createOrganization({ updatedAt: LONG_AGO });

      await testDb()
        .update(organizations)
        .set({ name: "Renamed" })
        .where(eq(organizations.id, organization.id));

      const [after] = await testDb()
        .select()
        .from(organizations)
        .where(eq(organizations.id, organization.id));

      expect(after?.updatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
    });

    it("leaves updated_at alone when an update changes nothing", async () => {
      // `WHEN (OLD.* IS DISTINCT FROM NEW.*)` on the trigger. Without it, any
      // write path that re-saves an unedited form makes `updated_at` mean "last
      // touched" rather than "last changed".
      const organization = await createOrganization({ updatedAt: LONG_AGO });

      await testDb()
        .update(organizations)
        .set({ name: organization.name })
        .where(eq(organizations.id, organization.id));

      const [after] = await testDb()
        .select()
        .from(organizations)
        .where(eq(organizations.id, organization.id));

      expect(after?.updatedAt.getTime()).toBe(LONG_AGO.getTime());
    });

    it("does not let the application write updated_at directly", async () => {
      // The trigger is BEFORE UPDATE, so it overwrites whatever the statement
      // supplied. This is what makes the column trustworthy: a manual UPDATE in
      // psql cannot leave it stale, and neither can a well-meant `set({ updatedAt })`.
      const organization = await createOrganization({ updatedAt: LONG_AGO });

      await testDb()
        .update(organizations)
        .set({ name: "Renamed", updatedAt: LONG_AGO })
        .where(eq(organizations.id, organization.id));

      const [after] = await testDb()
        .select()
        .from(organizations)
        .where(eq(organizations.id, organization.id));

      expect(after?.updatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
    });
  });

  describe("the migrations that were applied", () => {
    it("ran against a database with the trigger function in place", async () => {
      // One assertion that the schema under test is the committed migrations and
      // not something a previous run left behind. `set_updated_at` is created by
      // `drizzle/0001`, so its absence means the harness migrated nothing.
      const { rows } = await testDb().execute<{ count: string }>(
        sql`SELECT count(*)::text AS count FROM pg_proc WHERE proname = 'set_updated_at'`,
      );

      expect(rows[0]?.count).toBe("1");
    });
  });
});
