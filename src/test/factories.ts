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
import { eq } from "drizzle-orm";

import {
  buildingAccessCodes,
  buildingFacts,
  buildings,
  buildingUtilities,
  capitalItemAllocations,
  capitalItems,
  contacts,
  contactTags,
  invitations,
  memberships,
  organizations,
  plannedWork,
  rentPeriods,
  tasks,
  taxYears,
  transactions,
  units,
  users,
} from "@/db/schema";
import { parseKeyring, sealAccessCode } from "@/lib/access-code-cipher.mts";

import { testDb } from "./db";

/**
 * The integration suite's `ACCESS_CODE_KEYS`: base64url of
 * "integration-suite-not-a-real-key", a shape and not a secret. A test that
 * reveals a code sets the environment to this, so the application opens what
 * `createAccessCode` sealed.
 */
export const TEST_ACCESS_CODE_KEYS =
  "1:aW50ZWdyYXRpb24tc3VpdGUtbm90LWEtcmVhbC1rZXk";

const testKeyring = parseKeyring(TEST_ACCESS_CODE_KEYS);

type Organization = typeof organizations.$inferSelect;
type PlannedWork = typeof plannedWork.$inferSelect;
type PlannedWorkInput = typeof plannedWork.$inferInsert;
type TaxYear = typeof taxYears.$inferSelect;
type TaxYearInput = typeof taxYears.$inferInsert;
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
type BuildingFactsRow = typeof buildingFacts.$inferSelect;
type BuildingFactsInput = typeof buildingFacts.$inferInsert;
type Utility = typeof buildingUtilities.$inferSelect;
type UtilityInput = typeof buildingUtilities.$inferInsert;
type AccessCode = typeof buildingAccessCodes.$inferSelect;
type AccessCodeInput = typeof buildingAccessCodes.$inferInsert;
type RentPeriod = typeof rentPeriods.$inferSelect;
type RentPeriodInput = typeof rentPeriods.$inferInsert;
type CapitalItem = typeof capitalItems.$inferSelect;
type CapitalItemInput = typeof capitalItems.$inferInsert;
type CapitalItemAllocation = typeof capitalItemAllocations.$inferSelect;
type Task = typeof tasks.$inferSelect;
type TaskInput = typeof tasks.$inferInsert;
type Transaction = typeof transactions.$inferSelect;
type TransactionInput = typeof transactions.$inferInsert;

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

/**
 * A building's collection days. Takes the building as well as the org, both
 * required, for `createUnit`'s reason.
 */
export async function createBuildingFacts(
  orgId: string,
  buildingId: string,
  overrides: Partial<BuildingFactsInput> = {},
): Promise<BuildingFactsRow> {
  const rows = await testDb()
    .insert(buildingFacts)
    .values({ orgId, buildingId, trashDay: "thu", ...overrides })
    .returning();

  return firstRow(rows, "building_facts");
}

/** An owner-paid electric account, building-wide unless a unit is given. */
export async function createUtility(
  orgId: string,
  buildingId: string,
  overrides: Partial<UtilityInput> = {},
): Promise<Utility> {
  const rows = await testDb()
    .insert(buildingUtilities)
    .values({
      orgId,
      buildingId,
      kind: "electric",
      providerName: "AES Indiana",
      accountRef: "4192",
      avgMonthlyCents: 18_600,
      ...overrides,
    })
    .returning();

  return firstRow(rows, "building_utilities");
}

/**
 * A code, sealed for `orgId` under the suite's keyring the way the
 * application seals one — so a test that reveals it through the application
 * gets `code` back. Written through the harness's connection, which sees past
 * row-level security and is the only way a test can seal a code for one org
 * and store it in another org's row.
 */
export async function createAccessCode(
  orgId: string,
  buildingId: string,
  {
    code = "4417#",
    ...overrides
  }: Partial<Omit<AccessCodeInput, "secret" | "keyVersion">> & {
    code?: string;
  } = {},
): Promise<AccessCode> {
  const { secret, keyVersion } = sealAccessCode(testKeyring, orgId, code);

  const rows = await testDb()
    .insert(buildingAccessCodes)
    .values({
      orgId,
      buildingId,
      kind: "door",
      secret,
      keyVersion,
      ...overrides,
    })
    .returning();

  return firstRow(rows, "building_access_codes");
}

/**
 * One unit's month, not yet marked: September 2026 at $2,300 unless told
 * otherwise. Takes the org, the building and the unit, all three required,
 * because `rent_periods_unit` names all three — a factory that could invent
 * the building would let a test hold it fixed on one side of the key only.
 *
 * Written straight to the table, not through `ensureRentPeriods()`, so the
 * expected amount is whatever the test says rather than the unit's rent.
 */
export async function createRentPeriod(
  orgId: string,
  buildingId: string,
  unitId: string,
  overrides: Partial<RentPeriodInput> = {},
): Promise<RentPeriod> {
  const rows = await testDb()
    .insert(rentPeriods)
    .values({
      orgId,
      buildingId,
      unitId,
      periodMonth: "2026-09-01",
      amountExpectedCents: 230_000,
      ...overrides,
    })
    .returning();

  return firstRow(rows, "rent_periods");
}

/**
 * A shared gas furnace from 2009, estimated, at the catalogue's figures — the
 * building's unless a `unitId` is given, and then scoped to that unit alone
 * (`capital_items_allocation_scope` requires `building_only` of it, so the
 * factory sets that too unless told otherwise). Takes the building as well as
 * the org, both required, for `createUnit`'s reason.
 *
 * Written straight to the table, not through `addCapitalItems`, so a test says
 * exactly what the row holds rather than what the catalogue would give it.
 */
export async function createCapitalItem(
  orgId: string,
  buildingId: string,
  overrides: Partial<CapitalItemInput> = {},
): Promise<CapitalItem> {
  const rows = await testDb()
    .insert(capitalItems)
    .values({
      orgId,
      buildingId,
      typeSlug: "furnace-gas",
      label: "Gas furnace",
      installYear: 2009,
      expectedLifeYears: 20,
      replacementCostCents: 480_000,
      ...(overrides.unitId ? { allocation: "building_only" as const } : {}),
      ...overrides,
    })
    .returning();

  return firstRow(rows, "capital_items");
}

/**
 * Makes a shared item's split explicit: the item's `allocation` and its shares
 * in one transaction, because the rule that they sum to 10000 is judged at
 * commit and would refuse either half alone. Takes the org and the building
 * both, required, because both references out of a share name them.
 */
export async function splitCapitalItem(
  orgId: string,
  buildingId: string,
  capitalItemId: string,
  shares: readonly { unitId: string; shareBps: number }[],
): Promise<CapitalItemAllocation[]> {
  return await testDb().transaction(async (tx) => {
    await tx
      .update(capitalItems)
      .set({ allocation: "explicit" })
      .where(eq(capitalItems.id, capitalItemId));

    return await tx
      .insert(capitalItemAllocations)
      .values(
        shares.map((share) => ({
          orgId,
          buildingId,
          capitalItemId,
          ...share,
        })),
      )
      .returning();
  });
}

/**
 * Gutters cleaned every three months, due September 1 and not yet booked — the
 * building's, unless a `unitId` is given. Takes the building as well as the
 * org, both required, for `createUnit`'s reason.
 *
 * Written straight to the table, not through an action, so a test says
 * exactly what the row holds.
 */
export async function createTask(
  orgId: string,
  buildingId: string,
  overrides: Partial<TaskInput> = {},
): Promise<Task> {
  const rows = await testDb()
    .insert(tasks)
    .values({
      orgId,
      buildingId,
      title: "Clean the gutters",
      status: "scheduled",
      dueDate: "2026-09-01",
      estCostCents: 18_000,
      recurrenceMonths: 3,
      ...overrides,
    })
    .returning();

  return firstRow(rows, "tasks");
}

/**
 * A $180 repair on September 1, money out, the building's own — unless a
 * `unitId` is given. Takes the building as well as the org, both required,
 * for `createUnit`'s reason.
 *
 * Written straight to the table, not through an action, so a test says
 * exactly what the row holds — the sign included, which is the column's one
 * way to be wrong.
 */
export async function createTransaction(
  orgId: string,
  buildingId: string,
  overrides: Partial<TransactionInput> = {},
): Promise<Transaction> {
  const rows = await testDb()
    .insert(transactions)
    .values({
      orgId,
      buildingId,
      occurredOn: "2026-09-01",
      amountCents: -18_000,
      description: "Replaced the kitchen faucet",
      scheduleECategory: "repairs",
      classification: "unclassified",
      ...overrides,
    })
    .returning();

  return firstRow(rows, "transactions");
}

/**
 * A live plan for an item's next replacement in 2029, unclassified — unless
 * the overrides make it something else. With no `capitalItemId`, pass a
 * `title` and an `estCostCents` for a discretionary project, which the table
 * insists on. Takes the building as well as the org, both required, for
 * `createUnit`'s reason.
 */
export async function createPlannedWork(
  orgId: string,
  buildingId: string,
  overrides: Partial<PlannedWorkInput> = {},
): Promise<PlannedWork> {
  const rows = await testDb()
    .insert(plannedWork)
    .values({
      orgId,
      buildingId,
      plannedYear: 2029,
      ...overrides,
    })
    .returning();

  return firstRow(rows, "planned_work");
}

/**
 * An org's settings for 2026, as the table defaults them: the threshold at
 * $2,500, elected, and no rate. Pass `blendedRateBps` for a year with one.
 */
export async function createTaxYear(
  orgId: string,
  overrides: Partial<TaxYearInput> = {},
): Promise<TaxYear> {
  const rows = await testDb()
    .insert(taxYears)
    .values({ orgId, year: 2026, ...overrides })
    .returning();

  return firstRow(rows, "tax_years");
}
