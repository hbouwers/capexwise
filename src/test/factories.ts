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
 * Two factories here take no `orgId`, and both are on the tenancy root's side of
 * the boundary rather than exceptions to it. `createOrganization` builds the
 * root itself, which has no `org_id` of its own. `createUser` builds a row that
 * is deliberately *above* the boundary: a person belongs to more than one org
 * with one account (`docs/data-model.md` §2), so a `users` row that belonged to
 * an org would misrepresent the schema. `createMembership` is the one that joins
 * them, and it takes an `orgId` first like every domain factory does.
 */
import {
  buildings,
  contacts,
  contactTags,
  invitations,
  memberships,
  organizations,
  units,
  users,
} from "@/db/schema";

import { testDb } from "./db";

type Organization = typeof organizations.$inferSelect;
type OrganizationInput = typeof organizations.$inferInsert;
type User = typeof users.$inferSelect;
type UserInput = typeof users.$inferInsert;
type Membership = typeof memberships.$inferSelect;
type MembershipInput = typeof memberships.$inferInsert;
type Invitation = typeof invitations.$inferSelect;
type InvitationInput = typeof invitations.$inferInsert;
type Building = typeof buildings.$inferSelect;
type BuildingInput = typeof buildings.$inferInsert;
type Unit = typeof units.$inferSelect;
type UnitInput = typeof units.$inferInsert;
type Contact = typeof contacts.$inferSelect;
type ContactInput = typeof contacts.$inferInsert;
type ContactTag = typeof contactTags.$inferSelect;

/**
 * Distinguishes rows within a test. Not a random value: a slug of `test-org-2`
 * in a failure message says which of the two orgs a test made, where a random
 * suffix says only that it was made. Truncation between tests means the counter
 * never has to be unique for longer than one test.
 */
let sequence = 0;

/**
 * `returning()` on a single-row insert always yields one row, but its type is an
 * array and `noUncheckedIndexedAccess` is on, so the impossible case is still a
 * branch. It throws rather than asserting non-null: if it ever does happen, a
 * message beats a `TypeError` two lines later.
 */
function firstRow<T>(rows: T[], table: string): T {
  const [row] = rows;

  if (!row) {
    throw new Error(`Inserting into ${table} returned no row.`);
  }

  return row;
}

/**
 * Inserts an organization and returns the row as the database wrote it —
 * defaults, generated id and all — rather than the values handed in. Tests that
 * assert on `id`, `plan` or `createdAt` are then asserting on what Postgres
 * actually did, which is the point of a database-backed test. Every factory
 * below returns its row the same way and for the same reason.
 */
export async function createOrganization(
  overrides: Partial<OrganizationInput> = {},
): Promise<Organization> {
  sequence += 1;

  const rows = await testDb()
    .insert(organizations)
    .values({
      name: `Test Organization ${sequence}`,
      slug: `test-org-${sequence}`,
      ...overrides,
    })
    .returning();

  return firstRow(rows, "organizations");
}

/**
 * No `orgId`, and not an oversight — see the module comment. A user reaches an
 * org through `createMembership`, which is the only thing that puts them in one.
 */
export async function createUser(
  overrides: Partial<UserInput> = {},
): Promise<User> {
  sequence += 1;

  const rows = await testDb()
    .insert(users)
    .values({
      email: `test-user-${sequence}@example.test`,
      name: `Test User ${sequence}`,
      ...overrides,
    })
    .returning();

  return firstRow(rows, "users");
}

/**
 * The join, and the first factory to take the required `orgId`. `userId` is
 * required for the same reason: a membership that could invent its own user
 * would let a test assert on tenancy while quietly holding both sides fixed.
 */
export async function createMembership(
  orgId: string,
  userId: string,
  overrides: Partial<MembershipInput> = {},
): Promise<Membership> {
  const rows = await testDb()
    .insert(memberships)
    .values({ orgId, userId, ...overrides })
    .returning();

  return firstRow(rows, "memberships");
}

/**
 * `expiresAt` has no default in the schema — an invitation that never expires is
 * not a thing the table allows — so the factory supplies a plausible one rather
 * than making every caller invent a date it does not care about. A test about
 * expiry passes its own.
 */
export async function createInvitation(
  orgId: string,
  inviterId: string,
  overrides: Partial<InvitationInput> = {},
): Promise<Invitation> {
  sequence += 1;

  const rows = await testDb()
    .insert(invitations)
    .values({
      orgId,
      inviterId,
      email: `test-invitee-${sequence}@example.test`,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ...overrides,
    })
    .returning();

  return firstRow(rows, "invitations");
}

/**
 * An Indianapolis address by default, the demo city (#34), and in the city's
 * own zone. No basis: `buildings_basis_complete` makes that the one state that
 * needs no arithmetic, and a test about the basis passes all of it.
 */
export async function createBuilding(
  orgId: string,
  overrides: Partial<BuildingInput> = {},
): Promise<Building> {
  sequence += 1;

  const rows = await testDb()
    .insert(buildings)
    .values({
      orgId,
      addressLine1: `${sequence} N Delaware St`,
      city: "Indianapolis",
      region: "IN",
      postalCode: "46204",
      timezone: "America/Indiana/Indianapolis",
      ...overrides,
    })
    .returning();

  return firstRow(rows, "buildings");
}

/**
 * Takes the building as well as the org, both required, for the reason
 * `createMembership` takes the user: a unit that could invent its building
 * would let a test hold the org fixed on one side of the reference only —
 * which is exactly the cross-org case `units_building` exists to refuse.
 */
export async function createUnit(
  orgId: string,
  buildingId: string,
  overrides: Partial<UnitInput> = {},
): Promise<Unit> {
  sequence += 1;

  const rows = await testDb()
    .insert(units)
    .values({ orgId, buildingId, label: `Unit ${sequence}`, ...overrides })
    .returning();

  return firstRow(rows, "units");
}

/**
 * A tradesperson with a phone and an email, because those are what the card
 * is for. Somebody else's details, so every value is visibly a test one: a
 * 555-01 number and an `example.test` address.
 */
export async function createContact(
  orgId: string,
  overrides: Partial<ContactInput> = {},
): Promise<Contact> {
  sequence += 1;

  const rows = await testDb()
    .insert(contacts)
    .values({
      orgId,
      name: `Test Contact ${sequence}`,
      phone: "317-555-0100",
      email: `test-contact-${sequence}@example.test`,
      ...overrides,
    })
    .returning();

  return firstRow(rows, "contacts");
}

/**
 * Takes the org and the contact both, required, for the reason `createUnit`
 * takes the building: a tag that could invent its contact would hold the org
 * fixed on one side of `contact_tags_contact` only. `tag` is a slug from the
 * trade list the migrations seed.
 */
export async function tagContact(
  orgId: string,
  contactId: string,
  tag: string,
): Promise<ContactTag> {
  const rows = await testDb()
    .insert(contactTags)
    .values({ orgId, contactId, tag })
    .returning();

  return firstRow(rows, "contact_tags");
}
