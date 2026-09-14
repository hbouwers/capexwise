/**
 * What the building form's save does to a building's units: the reconcile in
 * `updateBuilding`, which turns a submitted list into edits, inserts and
 * deletes. The cross-org half of these actions is the isolation test's; this is
 * the half inside one org, where the failure is a unit silently lost, doubled,
 * or refused for a reason nobody typed.
 *
 * Driven as the form drives them — a signed session, then the action — so the
 * org comes from `getOrgContext()` as it does in a request. The session setup
 * is the isolation test's, which explains each line.
 */
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { buildings, units } from "@/db/schema";
import {
  type BuildingFields,
  buildingFields,
  emptyBuildingFields,
  UNREADABLE_FORM,
} from "@/lib/building-form";
import { applicationDatabaseUrl, testDb } from "@/test/db";
import {
  createBuilding,
  createMembership,
  createOrganization,
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
// Base64url of "integration-suite-not-a-real-key": a shape, not a secret.
process.env.ACCESS_CODE_KEYS = "1:aW50ZWdyYXRpb24tc3VpdGUtbm90LWEtcmVhbC1rZXk";

// Dynamic, and after the assignments above, for the reason the isolation test
// gives. A namespace, because `createBuilding` is also the factory's name.
const { getAuth } = await import("@/server/auth");
const actions = await import("@/server/actions/buildings");

/** An org with an owner, signed in as the requests below. */
async function signedInOrg() {
  const org = await createOrganization();
  const owner = await createUser();
  await createMembership(org.id, owner.id, { role: "owner" });

  const context = await getAuth().$context;
  const session = await context.internalAdapter.createSession(owner.id, false);
  const signature = await makeSignature(session.token, context.secret);

  request.headers = new Headers({
    cookie: `${context.authCookies.sessionToken.name}=${session.token}.${signature}`,
  });

  return org;
}

async function unitsOf(buildingId: string) {
  return await testDb()
    .select({ id: units.id, label: units.label, rentCents: units.rentCents })
    .from(units)
    .where(eq(units.buildingId, buildingId))
    .orderBy(units.label);
}

/** A duplex, A let at $1,250 and B at $1,195, as the edit form opens it. */
async function duplex() {
  const org = await signedInOrg();
  const building = await createBuilding(org.id);
  const a = await createUnit(org.id, building.id, {
    label: "A",
    status: "occupied",
    rentCents: 125_000,
  });
  const b = await createUnit(org.id, building.id, {
    label: "B",
    status: "occupied",
    rentCents: 119_500,
  });

  return { org, building, a, b, form: buildingFields(building, [a, b]) };
}

describe("createBuilding", () => {
  it("writes the building and its units, in cents", async () => {
    await signedInOrg();

    const form: BuildingFields = {
      ...emptyBuildingFields(),
      addressLine1: "412 N Delaware St",
      city: "Indianapolis",
      region: "IN",
      postalCode: "46204",
      timezone: "America/Indiana/Indianapolis",
      units: [
        {
          id: null,
          label: "A",
          status: "occupied",
          rent: "1,250",
          leaseEnd: "",
        },
        { id: null, label: "B", status: "vacant", rent: "", leaseEnd: "" },
      ],
      purchasePrice: "250,000",
      landValue: "46,000",
    };

    const result = await actions.createBuilding(form);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const [stored] = await testDb()
      .select()
      .from(buildings)
      .where(eq(buildings.id, result.buildingId));

    expect(stored?.buildingBasisCents).toBe(20_400_000);
    expect(await unitsOf(result.buildingId)).toMatchObject([
      { label: "A", rentCents: 125_000 },
      { label: "B", rentCents: null },
    ]);
  });

  it("returns the form's own messages, and writes nothing", async () => {
    await signedInOrg();

    const result = await actions.createBuilding({
      ...emptyBuildingFields(),
      units: [],
    });

    expect(result).toMatchObject({
      ok: false,
      errors: {
        addressLine1: "Enter the street address.",
        units: "Add at least one unit.",
      },
    });
    expect(await testDb().select().from(buildings)).toEqual([]);
  });
});

describe("updateBuilding", () => {
  it("swaps two units' labels without tripping over its own constraint", async () => {
    // A becomes B and B becomes A. Written one row at a time, the first update
    // would find the other unit still holding the label it wants.
    const { building, a, b, form } = await duplex();
    const [first, second] = form.units;

    const result = await actions.updateBuilding(building.id, {
      ...form,
      units: [
        { ...first!, label: "B" },
        { ...second!, label: "A" },
      ],
    });

    expect(result.ok).toBe(true);
    expect(await unitsOf(building.id)).toEqual([
      { id: b.id, label: "A", rentCents: 119_500 },
      { id: a.id, label: "B", rentCents: 125_000 },
    ]);
  });

  it("removes a unit left off the form, and adds one new to it", async () => {
    const { building, a, form } = await duplex();

    const result = await actions.updateBuilding(building.id, {
      ...form,
      units: [
        form.units[0]!,
        // Takes the removed unit's label in the same save.
        { id: null, label: "B", status: "vacant", rent: "", leaseEnd: "" },
      ],
    });

    expect(result.ok).toBe(true);

    const after = await unitsOf(building.id);
    expect(after.map((unit) => unit.label)).toEqual(["A", "B"]);
    expect(after[0]?.id).toBe(a.id);
    expect(after[1]).toMatchObject({ rentCents: null });
  });

  it("refuses a unit of another of the org's buildings, and writes nothing", async () => {
    // Same org, so row-level security has nothing to say: the id is a lookup
    // into this building's units, and this is the check that it is one.
    const { org, building, form } = await duplex();
    const other = await createBuilding(org.id);
    const elsewhere = await createUnit(org.id, other.id, { label: "C" });

    const result = await actions.updateBuilding(building.id, {
      ...form,
      label: "Renamed",
      units: [
        ...form.units,
        {
          id: elsewhere.id,
          label: "C",
          status: "vacant",
          rent: "",
          leaseEnd: "",
        },
      ],
    });

    expect(result).toEqual({ ok: false, errors: { form: UNREADABLE_FORM } });

    const [stored] = await testDb()
      .select({ label: buildings.label })
      .from(buildings)
      .where(eq(buildings.id, building.id));
    expect(stored?.label).toBeNull();
    expect(await unitsOf(other.id)).toHaveLength(1);
  });

  it("refuses to remove every unit", async () => {
    const { building, form } = await duplex();

    const result = await actions.updateBuilding(building.id, {
      ...form,
      units: [],
    });

    expect(result).toEqual({
      ok: false,
      errors: { units: "Add at least one unit." },
    });
    expect(await unitsOf(building.id)).toHaveLength(2);
  });
});

describe("archiveBuilding and restoreBuilding", () => {
  it("archives an active building once, and restores it", async () => {
    const { building } = await duplex();

    expect(await actions.archiveBuilding(building.id)).toEqual({ ok: true });
    // Already archived: nothing to do, and the form hears so.
    expect(await actions.archiveBuilding(building.id)).toEqual({ ok: false });
    expect(await actions.restoreBuilding(building.id)).toEqual({ ok: true });

    const [stored] = await testDb()
      .select({ status: buildings.status })
      .from(buildings)
      .where(eq(buildings.id, building.id));
    expect(stored?.status).toBe("active");
  });

  it("does not archive a sold building", async () => {
    // Sold is #43's, and archiving it would lose which of the two it was.
    const org = await signedInOrg();
    const building = await createBuilding(org.id, { status: "sold" });

    expect(await actions.archiveBuilding(building.id)).toEqual({ ok: false });
    expect(await actions.restoreBuilding(building.id)).toEqual({ ok: false });
  });

  it.each([
    ["not an id", "412"],
    ["nothing", undefined],
  ])("does nothing with %s", async (_, id) => {
    await signedInOrg();

    expect(await actions.archiveBuilding(id)).toEqual({ ok: false });
  });
});
