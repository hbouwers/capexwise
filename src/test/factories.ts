/**
 * Test data, built by function rather than by fixture file.
 *
 * The rule these follow, and the reason they are a shared module rather than a
 * helper at the top of whichever test needed one first: **every factory for a
 * domain table takes an `orgId` as its first required argument.** Not an
 * optional one with a default that quietly invents an org — a required one. The
 * hard rule in CLAUDE.md is that `org_id` is on every domain table and leads
 * every index, and a factory that can produce a row without being told which org
 * it belongs to is a way to write a test that passes with the tenancy boundary
 * broken. Required argument, no default, no exceptions.
 *
 * `createOrganization` is the one factory that takes no `orgId`, because
 * `organizations` is the tenancy root and has no `org_id` of its own — every
 * other factory's first argument comes from this one's return value.
 *
 * There is exactly one factory here because there is exactly one table (#24 adds
 * `users`, `memberships` and `invitations`). The shape is set now so the second
 * one is written to it rather than establishing a different pattern.
 */
import { organizations } from "@/db/schema";

import { testDb } from "./db";

type Organization = typeof organizations.$inferSelect;
type OrganizationInput = typeof organizations.$inferInsert;

/**
 * Distinguishes rows within a test. Not a random value: a slug of `test-org-2`
 * in a failure message says which of the two orgs a test made, where a random
 * suffix says only that it was made. Truncation between tests means the counter
 * never has to be unique for longer than one test.
 */
let sequence = 0;

/**
 * Inserts an organization and returns the row as the database wrote it —
 * defaults, generated id and all — rather than the values handed in. Tests that
 * assert on `id`, `plan` or `createdAt` are then asserting on what Postgres
 * actually did, which is the point of a database-backed test.
 */
export async function createOrganization(
  overrides: Partial<OrganizationInput> = {},
): Promise<Organization> {
  sequence += 1;

  const [organization] = await testDb()
    .insert(organizations)
    .values({
      name: `Test Organization ${sequence}`,
      slug: `test-org-${sequence}`,
      ...overrides,
    })
    .returning();

  // `returning()` on a single-row insert always yields one row, but its type is
  // an array and `noUncheckedIndexedAccess` is on, so the impossible case is
  // still a branch. It throws rather than asserting non-null: if it ever does
  // happen, a message beats a `TypeError` two lines later.
  if (!organization) {
    throw new Error("Inserting an organization returned no row.");
  }

  return organization;
}
