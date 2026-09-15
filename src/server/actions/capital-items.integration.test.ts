/**
 * What adding and replacing equipment do inside one org: the catalogue's
 * defaults copied onto each item and never read again, the rows one tick
 * becomes for each scope, a replacement as a row of its own with the old one
 * untouched but for its status, and the building form's refusal to remove a
 * unit that has equipment. The cross-org half is the isolation test's.
 *
 * Driven as the modal and the editor will drive them (#110) — a signed
 * session, then the function — as `rent-periods.integration.test.ts` does,
 * whose session setup this repeats.
 */
import { makeSignature } from "better-auth/crypto";
import { asc, eq, TransactionRollbackError } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import {
  buildings,
  capitalItemAllocations,
  capitalItems,
  capitalItemTypes,
  units,
} from "@/db/schema";
import { buildingFields } from "@/lib/building-form";
import { todayIn, yearOf } from "@/lib/dates";
import { UNREADABLE_FORM } from "@/lib/forms";
import { applicationDatabaseUrl, testDb } from "@/test/db";
import {
  createBuilding,
  createCapitalItem,
  createMembership,
  createOrganization,
  createUnit,
  createUser,
  splitCapitalItem,
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
const { addCapitalItems, recordReplacement } =
  await import("@/server/actions/capital-items");
const { updateBuilding } = await import("@/server/actions/buildings");
const { getBuilding } = await import("@/server/queries/buildings");

const ZONE = "America/Indiana/Indianapolis";
const today = todayIn(ZONE);
const thisYear = yearOf(today);

/**
 * A duplex, its owner signed in as the requests below, with a third unit
 * that was retired — so every "each unit" below has one to leave out.
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

  const building = await createBuilding(org.id, {
    timezone: ZONE,
    buildYear: 1924,
  });
  const a = await createUnit(org.id, building.id, {
    label: "A",
    status: "occupied",
    rentCents: 230_000,
  });
  const b = await createUnit(org.id, building.id, {
    label: "B",
    status: "vacant",
  });
  const c = await createUnit(org.id, building.id, {
    label: "C",
    status: "retired",
  });

  return { org, building, a, b, c };
}

async function itemsOf(buildingId: string) {
  return await testDb()
    .select()
    .from(capitalItems)
    .where(eq(capitalItems.buildingId, buildingId))
    .orderBy(asc(capitalItems.id));
}

async function itemRow(id: string) {
  const [row] = await testDb()
    .select()
    .from(capitalItems)
    .where(eq(capitalItems.id, id));

  return row!;
}

describe("addCapitalItems", () => {
  it("copies the catalogue's label, life and cost onto the item, estimated", async () => {
    const { building } = await duplex();

    const result = await addCapitalItems(building.id, {
      items: [{ type: "roof-asphalt", scope: "shared", installYear: 2014 }],
    });

    expect(result).toEqual({ ok: true, itemIds: [expect.any(String)] });
    expect(await itemsOf(building.id)).toEqual([
      expect.objectContaining({
        typeSlug: "roof-asphalt",
        label: "Roof, asphalt shingle",
        unitId: null,
        allocation: "by_unit_count",
        installYear: 2014,
        installDate: null,
        confidence: "estimated",
        expectedLifeYears: 20,
        replacementCostCents: 1_050_000,
        actualCostCents: null,
        status: "active",
      }),
    ]);
  });

  it("keeps the item's figures when the catalogue is refreshed", async () => {
    // The point of copying (§5): a later migration that corrects a default
    // changes what the next item starts with, and nothing already entered.
    // Run in a transaction that is rolled back, so the catalogue the rest of
    // the suite reads is the seeded one.
    const { building } = await duplex();
    const added = await addCapitalItems(building.id, {
      items: [{ type: "furnace-gas", scope: "each", installYear: 2011 }],
    });
    expect(added.ok).toBe(true);

    // Read inside and asserted outside: an assertion that failed in here
    // would reject the transaction too, and pass for the rollback.
    let afterRefresh: { life: number; cost: number }[] = [];

    await expect(
      testDb().transaction(async (tx) => {
        await tx
          .update(capitalItemTypes)
          .set({ defaultLifeYears: 25, defaultCostCents: 650_000 })
          .where(eq(capitalItemTypes.slug, "furnace-gas"));

        afterRefresh = await tx
          .select({
            life: capitalItems.expectedLifeYears,
            cost: capitalItems.replacementCostCents,
          })
          .from(capitalItems)
          .where(eq(capitalItems.buildingId, building.id));

        tx.rollback();
      }),
    ).rejects.toThrow(TransactionRollbackError);

    expect(afterRefresh).toEqual([
      { life: 20, cost: 480_000 },
      { life: 20, cost: 480_000 },
    ]);
  });

  it("makes one item per unit that is not retired for each unit", async () => {
    const { building, a, b } = await duplex();

    const result = await addCapitalItems(building.id, {
      items: [{ type: "refrigerator", scope: "each", installYear: 2019 }],
    });

    expect(result.ok && result.itemIds).toHaveLength(2);
    expect(
      (await itemsOf(building.id)).map((item) => [
        item.unitId,
        item.allocation,
        item.label,
      ]),
    ).toEqual([
      [a.id, "building_only", "Refrigerator"],
      [b.id, "building_only", "Refrigerator"],
    ]);
  });

  it("puts an item on the one unit named", async () => {
    const { building, b } = await duplex();

    expect(
      (
        await addCapitalItems(building.id, {
          items: [{ type: "water-heater", scope: b.id, installYear: 2020 }],
        })
      ).ok,
    ).toBe(true);
    expect(
      (await itemsOf(building.id)).map((item) => [
        item.unitId,
        item.allocation,
      ]),
    ).toEqual([[b.id, "building_only"]]);
  });

  it("adds a type the building already has, as a second item", async () => {
    // Already tracked is a note, not a lock: a duplex has two refrigerators,
    // and a third bought for the basement is a third.
    const { org, building, a } = await duplex();
    await createCapitalItem(org.id, building.id, {
      unitId: a.id,
      typeSlug: "refrigerator",
      label: "Refrigerator",
    });

    await addCapitalItems(building.id, {
      items: [{ type: "refrigerator", scope: a.id, installYear: 2022 }],
    });

    expect(
      (await itemsOf(building.id)).filter((item) => item.unitId === a.id),
    ).toHaveLength(2);
  });

  it("adds everything or nothing", async () => {
    // The retired unit is refused, so the roof ticked beside it is not added
    // either — the modal's ticks still mean what they did.
    const { building, c } = await duplex();

    const result = await addCapitalItems(building.id, {
      items: [
        { type: "roof-asphalt", scope: "shared", installYear: 2014 },
        { type: "refrigerator", scope: c.id, installYear: 2019 },
      ],
    });

    expect(result).toEqual({
      ok: false,
      errors: {
        form: "A unit you chose is no longer part of this building. Reload the page and choose again.",
      },
    });
    expect(await itemsOf(building.id)).toEqual([]);
  });

  it("refuses each unit on a building with none left", async () => {
    const { building } = await duplex();
    await testDb()
      .update(units)
      .set({ status: "retired" })
      .where(eq(units.buildingId, building.id));

    expect(
      await addCapitalItems(building.id, {
        items: [{ type: "dishwasher", scope: "each", installYear: 2019 }],
      }),
    ).toEqual({
      ok: false,
      errors: {
        form: "This building has no units left to add equipment to. Choose Shared instead.",
      },
    });
    expect(await itemsOf(building.id)).toEqual([]);
  });

  it("refuses what the modal could not have sent", async () => {
    const { building } = await duplex();

    for (const items of [
      [],
      [{ type: "hot-tub", scope: "shared", installYear: 2014 }],
      [{ type: "roof-asphalt", scope: "the attic", installYear: 2014 }],
      [{ type: "roof-asphalt", scope: "shared", installYear: 2014.5 }],
      // A year that has not happened where the building is.
      [{ type: "roof-asphalt", scope: "shared", installYear: thisYear + 1 }],
    ]) {
      expect(await addCapitalItems(building.id, { items })).toEqual({
        ok: false,
        errors: { form: UNREADABLE_FORM },
      });
    }

    expect(await itemsOf(building.id)).toEqual([]);
  });

  it("ignores any figure the request sends in place of the catalogue's", async () => {
    // The defaults are read inside the transaction, never taken from the
    // browser — a label, a life or a cost in the submission is not a field
    // the modal has, and is dropped with the rest of what it does not
    // describe.
    const { building } = await duplex();

    await addCapitalItems(building.id, {
      items: [
        {
          type: "boiler",
          scope: "shared",
          installYear: 2001,
          label: "Boiler (free)",
          expectedLifeYears: 99,
          replacementCostCents: 1,
        },
      ],
    });

    expect(await itemsOf(building.id)).toEqual([
      expect.objectContaining({
        label: "Boiler",
        expectedLifeYears: 25,
        replacementCostCents: 590_000,
      }),
    ]);
  });

  it("adds nothing to an archived building", async () => {
    const { building } = await duplex();
    await testDb()
      .update(buildings)
      .set({ status: "archived" })
      .where(eq(buildings.id, building.id));

    expect(
      (
        await addCapitalItems(building.id, {
          items: [{ type: "roof-asphalt", scope: "shared", installYear: 2014 }],
        })
      ).ok,
    ).toBe(false);
    expect(await itemsOf(building.id)).toEqual([]);
  });
});

describe("recordReplacement", () => {
  const replaced = { installedOn: today, cost: "$7,420" };

  it("adds the new item as a row of its own, and marks the old one replaced", async () => {
    const { org, building, a } = await duplex();
    const old = await createCapitalItem(org.id, building.id, {
      unitId: a.id,
      label: "Furnace, basement",
      expectedLifeYears: 18,
      replacementCostCents: 520_000,
      actualCostCents: 310_000,
      notes: "Carrier 58STA, serial on the door",
    });

    const result = await recordReplacement(old.id, replaced);

    expect(result).toEqual({ ok: true, itemId: expect.any(String) });
    const successorId = result.ok ? result.itemId : "";

    // The old row: its year, its cost and its notes exactly as they were —
    // the depreciation schedule's history (#44) — and a pointer forward.
    expect(await itemRow(old.id)).toEqual({
      ...old,
      status: "replaced",
      replacedById: successorId,
      updatedAt: expect.any(Date),
    });

    // The new row: the same thing in the same place, audited from the day it
    // went in, with the person's life and cost for the next one.
    expect(await itemRow(successorId)).toEqual(
      expect.objectContaining({
        buildingId: building.id,
        unitId: a.id,
        typeSlug: "furnace-gas",
        label: "Furnace, basement",
        installYear: thisYear,
        installDate: today,
        confidence: "audited",
        expectedLifeYears: 18,
        replacementCostCents: 520_000,
        actualCostCents: 742_000,
        status: "active",
        allocation: "building_only",
        replacedById: null,
        notes: null,
      }),
    );
  });

  it("carries an explicit split over to the new item", async () => {
    const { org, building, a, b } = await duplex();
    const old = await createCapitalItem(org.id, building.id, {
      typeSlug: "boiler",
      label: "Boiler",
    });
    await splitCapitalItem(org.id, building.id, old.id, [
      { unitId: a.id, shareBps: 6000 },
      { unitId: b.id, shareBps: 4000 },
    ]);

    const result = await recordReplacement(old.id, replaced);
    const successorId = result.ok ? result.itemId : "";

    expect(await itemRow(successorId)).toMatchObject({
      unitId: null,
      allocation: "explicit",
    });
    expect(
      await testDb()
        .select({
          unitId: capitalItemAllocations.unitId,
          shareBps: capitalItemAllocations.shareBps,
        })
        .from(capitalItemAllocations)
        .where(eq(capitalItemAllocations.capitalItemId, successorId))
        .orderBy(asc(capitalItemAllocations.shareBps)),
    ).toEqual([
      { unitId: b.id, shareBps: 4000 },
      { unitId: a.id, shareBps: 6000 },
    ]);
  });

  it("says what is wrong with the form, and writes nothing", async () => {
    const { org, building } = await duplex();
    const old = await createCapitalItem(org.id, building.id, {
      installYear: 2009,
    });

    expect(
      await recordReplacement(old.id, {
        installedOn: "2008-06-01",
        cost: "",
      }),
    ).toEqual({
      ok: false,
      errors: {
        installedOn:
          "Enter a date in 2009 or later — the one it replaces went in then.",
      },
    });
    expect(await itemsOf(building.id)).toEqual([old]);
  });

  it("replaces an item once, and not one that was removed", async () => {
    // A second `Record replacement` from a page drawn before the first finds
    // the item replaced already, and is refused rather than adding a second
    // successor.
    const { org, building } = await duplex();
    const old = await createCapitalItem(org.id, building.id);
    const gone = await createCapitalItem(org.id, building.id, {
      status: "removed",
    });

    expect((await recordReplacement(old.id, replaced)).ok).toBe(true);
    expect((await recordReplacement(old.id, replaced)).ok).toBe(false);
    expect((await recordReplacement(gone.id, replaced)).ok).toBe(false);
    expect(await itemsOf(building.id)).toHaveLength(3);
  });

  it("replaces nothing on an archived building", async () => {
    const { org, building } = await duplex();
    const old = await createCapitalItem(org.id, building.id);
    await testDb()
      .update(buildings)
      .set({ status: "archived" })
      .where(eq(buildings.id, building.id));

    expect((await recordReplacement(old.id, replaced)).ok).toBe(false);
    expect(await itemsOf(building.id)).toEqual([old]);
  });
});

describe("updateBuilding, once a unit has equipment", () => {
  it("reads which units have equipment, so the form offers Retire", async () => {
    // Its own item for A, a share of a split boiler for B, and nothing for
    // the retired C — the shared roof divided by unit count holds nobody.
    const { org, building, a, b } = await duplex();
    await createCapitalItem(org.id, building.id, { unitId: a.id });
    await createCapitalItem(org.id, building.id, { typeSlug: "roof-asphalt" });
    const boiler = await createCapitalItem(org.id, building.id, {
      typeSlug: "boiler",
    });
    await splitCapitalItem(org.id, building.id, boiler.id, [
      { unitId: b.id, shareBps: 10_000 },
    ]);

    const detail = (await getBuilding(building.id))!;

    expect(detail.units.map((unit) => [unit.label, unit.hasEquipment])).toEqual(
      [
        ["A", true],
        ["B", true],
        ["C", false],
      ],
    );
  });

  it("refuses to remove a unit with its own item, and says to retire it", async () => {
    const { org, building, a } = await duplex();
    await createCapitalItem(org.id, building.id, { unitId: a.id });
    const detail = (await getBuilding(building.id))!;

    const fields = buildingFields(detail.building, detail.units);
    const result = await updateBuilding(building.id, {
      ...fields,
      units: fields.units.filter((unit) => unit.id !== a.id),
    });

    expect(result).toEqual({
      ok: false,
      errors: {
        units:
          "Unit “A” has equipment recorded, so it can’t be removed. Retire it instead — its equipment stays on the building’s page.",
      },
    });
  });

  it("refuses to remove a unit with a share of a shared item", async () => {
    const { org, building, a, b } = await duplex();
    const boiler = await createCapitalItem(org.id, building.id);
    await splitCapitalItem(org.id, building.id, boiler.id, [
      { unitId: a.id, shareBps: 5000 },
      { unitId: b.id, shareBps: 5000 },
    ]);
    const detail = (await getBuilding(building.id))!;

    const fields = buildingFields(detail.building, detail.units);
    const result = await updateBuilding(building.id, {
      ...fields,
      units: fields.units.filter((unit) => unit.id !== b.id),
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.units).toMatch(
      /^Unit “B” has equipment/,
    );
  });

  it("removes a unit the shared items are only divided across", async () => {
    // `by_unit_count` stores no number, so there is nothing to hold the unit:
    // the roof divides across whoever is left.
    const { org, building, b } = await duplex();
    await createCapitalItem(org.id, building.id, { typeSlug: "roof-asphalt" });
    const detail = (await getBuilding(building.id))!;

    const fields = buildingFields(detail.building, detail.units);
    const result = await updateBuilding(building.id, {
      ...fields,
      units: fields.units.filter((unit) => unit.id !== b.id),
    });

    expect(result).toEqual({ ok: true, buildingId: building.id });
  });
});
