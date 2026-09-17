/**
 * What adding, editing and replacing equipment do inside one org: the
 * catalogue's defaults copied onto each item and never read again, the rows
 * one tick becomes for each scope, an edit that follows its scope with the
 * item's allocation, a replacement as a row of its own with the old one
 * untouched but for its status, a removal that is not a delete, and the
 * building form's refusal to remove a unit that has equipment. The cross-org
 * half is the isolation test's.
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
const {
  addCapitalItems,
  confirmCapitalItem,
  recordReplacement,
  removeCapitalItem,
  undoAddCapitalItems,
  updateCapitalItem,
} = await import("@/server/actions/capital-items");
const { getOrgContext } = await import("@/server/org-context");
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

describe("undoAddCapitalItems", () => {
  it("removes exactly the rows the add made", async () => {
    const { org, building } = await duplex();
    const before = await createCapitalItem(org.id, building.id);

    const added = await addCapitalItems(building.id, {
      items: [
        { type: "refrigerator", scope: "each", installYear: 2019 },
        { type: "roof-asphalt", scope: "shared", installYear: 2014 },
      ],
    });
    if (!added.ok) throw new Error("The add was refused.");
    expect(added.itemIds).toHaveLength(3);

    expect(await undoAddCapitalItems(building.id, added.itemIds)).toEqual({
      ok: true,
      removed: 3,
    });
    expect(await itemsOf(building.id)).toEqual([before]);
  });

  it("leaves an item confirmed since the add", async () => {
    const { building } = await duplex();
    const added = await addCapitalItems(building.id, {
      items: [{ type: "refrigerator", scope: "each", installYear: 2019 }],
    });
    if (!added.ok) throw new Error("The add was refused.");
    const [confirmed, untouched] = added.itemIds as [string, string];

    expect(
      await confirmCapitalItem(confirmed, {
        installedOn: "2018-05-14",
        cost: "",
      }),
    ).toEqual({ ok: true });

    expect(await undoAddCapitalItems(building.id, added.itemIds)).toEqual({
      ok: true,
      removed: 1,
    });
    expect((await itemsOf(building.id)).map((item) => item.id)).toEqual([
      confirmed,
    ]);
    expect(await itemsOf(building.id)).not.toContainEqual(
      expect.objectContaining({ id: untouched }),
    );
  });

  it("takes nothing from another building by its ids", async () => {
    const { org, building } = await duplex();
    const other = await createBuilding(org.id, { timezone: ZONE });
    const theirs = await createCapitalItem(org.id, other.id);

    expect(await undoAddCapitalItems(building.id, [theirs.id])).toEqual({
      ok: true,
      removed: 0,
    });
    expect(await itemsOf(other.id)).toEqual([theirs]);
  });

  it("removes nothing on an archived building", async () => {
    const { org, building } = await duplex();
    const item = await createCapitalItem(org.id, building.id);
    await testDb()
      .update(buildings)
      .set({ status: "archived" })
      .where(eq(buildings.id, building.id));

    expect(await undoAddCapitalItems(building.id, [item.id])).toEqual({
      ok: false,
    });
    expect(await itemsOf(building.id)).toEqual([item]);
  });

  it("refuses a list the toast could not have sent", async () => {
    const { building } = await duplex();

    expect(await undoAddCapitalItems(building.id, [])).toEqual({ ok: false });
    expect(await undoAddCapitalItems(building.id, ["not-an-id"])).toEqual({
      ok: false,
    });
  });
});

describe("capital_items_delete_as_added", () => {
  it("lets the scoped role delete an item only while it is as the checklist left it", async () => {
    // The restrictive policy in `0021`, driven through the scoped handle with
    // no filter of its own — the delete an action that forgot its conditions
    // would run. Only the estimated, active item with no cost goes.
    const { org, building } = await duplex();
    const asAdded = await createCapitalItem(org.id, building.id);
    const audited = await createCapitalItem(org.id, building.id, {
      confidence: "audited",
      installYear: 2011,
      installDate: "2011-03-09",
    });
    const costed = await createCapitalItem(org.id, building.id, {
      actualCostCents: 410_000,
    });
    const removed = await createCapitalItem(org.id, building.id, {
      status: "removed",
    });

    const { db } = await getOrgContext();
    const deleted = await db.run((tx) =>
      tx
        .delete(capitalItems)
        .where(eq(capitalItems.buildingId, building.id))
        .returning({ id: capitalItems.id }),
    );

    expect(deleted).toEqual([{ id: asAdded.id }]);
    expect(await itemsOf(building.id)).toEqual([audited, costed, removed]);
  });
});

describe("confirmCapitalItem", () => {
  it("marks the item audited, from the day it went in, with its cost as its basis", async () => {
    const { org, building } = await duplex();
    const item = await createCapitalItem(org.id, building.id, {
      installYear: 2014,
      replacementCostCents: 480_000,
    });

    expect(
      await confirmCapitalItem(item.id, {
        installedOn: "2011-03-09",
        cost: "$4,180",
      }),
    ).toEqual({ ok: true });

    expect(await itemRow(item.id)).toEqual({
      ...item,
      confidence: "audited",
      installDate: "2011-03-09",
      installYear: 2011,
      actualCostCents: 418_000,
      // The forecast's figure is the editor's to change, not Confirm's.
      replacementCostCents: 480_000,
      updatedAt: expect.any(Date),
    });
  });

  it("says what is wrong with the form, and writes nothing", async () => {
    const { org, building } = await duplex();
    const item = await createCapitalItem(org.id, building.id);

    expect(
      await confirmCapitalItem(item.id, { installedOn: "", cost: "lots" }),
    ).toEqual({
      ok: false,
      errors: {
        installedOn: "Enter the day it was installed.",
        cost: "Enter an amount in dollars, like 1,250.",
      },
    });
    expect(await itemRow(item.id)).toEqual(item);
  });

  it("confirms an item once, and not one replaced or removed", async () => {
    const { org, building } = await duplex();
    const item = await createCapitalItem(org.id, building.id);
    const gone = await createCapitalItem(org.id, building.id, {
      status: "removed",
    });
    const confirmation = { installedOn: "2010-06-01", cost: "" };

    expect((await confirmCapitalItem(item.id, confirmation)).ok).toBe(true);
    const once = await itemRow(item.id);

    expect(
      await confirmCapitalItem(item.id, {
        installedOn: "2012-01-01",
        cost: "",
      }),
    ).toEqual({
      ok: false,
      errors: {
        form: "This item could not be confirmed. Reload the page — it may have changed since you opened it.",
      },
    });
    expect(await itemRow(item.id)).toEqual(once);
    expect((await confirmCapitalItem(gone.id, confirmation)).ok).toBe(false);
  });

  it("confirms nothing on an archived building", async () => {
    const { org, building } = await duplex();
    const item = await createCapitalItem(org.id, building.id);
    await testDb()
      .update(buildings)
      .set({ status: "archived" })
      .where(eq(buildings.id, building.id));

    expect(
      (await confirmCapitalItem(item.id, { installedOn: today, cost: "" })).ok,
    ).toBe(false);
    expect(await itemRow(item.id)).toEqual(item);
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

describe("updateCapitalItem", () => {
  /** The editor's form for the factory's furnace, every field changed. */
  const edited = {
    label: "Furnace, basement",
    confidence: "estimated",
    installYear: "2011",
    installedOn: "",
    cost: "3,100",
    expectedLife: "18",
    replacementCost: "$5,200",
    scope: "shared",
    notes: "Carrier 58STA, serial on the door.",
  };

  it("writes the editor's fields onto the item", async () => {
    const { org, building } = await duplex();
    const item = await createCapitalItem(org.id, building.id);

    expect(await updateCapitalItem(item.id, edited)).toEqual({ ok: true });
    expect(await itemRow(item.id)).toEqual({
      ...item,
      label: "Furnace, basement",
      installYear: 2011,
      actualCostCents: 310_000,
      expectedLifeYears: 18,
      replacementCostCents: 520_000,
      notes: "Carrier 58STA, serial on the door.",
      updatedAt: expect.any(Date),
    });
  });

  it("makes an item audited from its date, and estimated again without one", async () => {
    const { org, building } = await duplex();
    const item = await createCapitalItem(org.id, building.id);

    expect(
      await updateCapitalItem(item.id, {
        ...edited,
        confidence: "audited",
        installedOn: "2011-03-09",
      }),
    ).toEqual({ ok: true });
    expect(await itemRow(item.id)).toMatchObject({
      confidence: "audited",
      installYear: 2011,
      installDate: "2011-03-09",
    });

    // Back to a guess: the date goes, the year it gave stays.
    expect(
      await updateCapitalItem(item.id, { ...edited, installYear: "2010" }),
    ).toEqual({ ok: true });
    expect(await itemRow(item.id)).toMatchObject({
      confidence: "estimated",
      installYear: 2010,
      installDate: null,
    });
  });

  it("moves a shared item onto a unit, and its allocation with it", async () => {
    const { org, building, a } = await duplex();
    const item = await createCapitalItem(org.id, building.id);

    expect(
      await updateCapitalItem(item.id, { ...edited, scope: a.id }),
    ).toEqual({ ok: true });
    expect(await itemRow(item.id)).toMatchObject({
      unitId: a.id,
      allocation: "building_only",
    });

    // And back: shared again, divided by unit count.
    expect(await updateCapitalItem(item.id, edited)).toEqual({ ok: true });
    expect(await itemRow(item.id)).toMatchObject({
      unitId: null,
      allocation: "by_unit_count",
    });
  });

  it("keeps an explicit split as it is, and keeps the item shared", async () => {
    const { org, building, a, b } = await duplex();
    const item = await createCapitalItem(org.id, building.id, {
      typeSlug: "boiler",
      label: "Boiler",
    });
    await splitCapitalItem(org.id, building.id, item.id, [
      { unitId: a.id, shareBps: 6000 },
      { unitId: b.id, shareBps: 4000 },
    ]);
    const shares = () =>
      testDb()
        .select({ unitId: capitalItemAllocations.unitId })
        .from(capitalItemAllocations)
        .where(eq(capitalItemAllocations.capitalItemId, item.id));

    // An edit that leaves it shared leaves the split alone.
    expect(await updateCapitalItem(item.id, edited)).toEqual({ ok: true });
    expect(await itemRow(item.id)).toMatchObject({ allocation: "explicit" });
    expect(await shares()).toHaveLength(2);

    // Moving it onto a unit would drop the shares, which nothing deletes on
    // its own (§7) — so it is refused, and the split stands.
    expect(
      await updateCapitalItem(item.id, { ...edited, scope: b.id }),
    ).toEqual({
      ok: false,
      errors: {
        scope:
          "This item’s cost is split across units by hand, so it stays shared.",
      },
    });
    expect(await itemRow(item.id)).toMatchObject({
      unitId: null,
      allocation: "explicit",
    });
    expect(await shares()).toHaveLength(2);
  });

  it("keeps an item on its retired unit, and puts nothing new there", async () => {
    const { org, building, c } = await duplex();
    const kept = await createCapitalItem(org.id, building.id, {
      unitId: c.id,
    });
    const moved = await createCapitalItem(org.id, building.id);

    expect(
      await updateCapitalItem(kept.id, { ...edited, scope: c.id }),
    ).toEqual({ ok: true });
    expect(await itemRow(kept.id)).toMatchObject({ unitId: c.id });

    expect(
      await updateCapitalItem(moved.id, { ...edited, scope: c.id }),
    ).toEqual({
      ok: false,
      errors: {
        scope:
          "That unit is no longer part of this building. Choose another, or Shared.",
      },
    });
    expect(await itemRow(moved.id)).toEqual(moved);
  });

  it("puts an item on no unit of another building", async () => {
    const { org, building } = await duplex();
    const other = await createBuilding(org.id);
    const elsewhere = await createUnit(org.id, other.id, { label: "1" });
    const item = await createCapitalItem(org.id, building.id);

    expect(
      await updateCapitalItem(item.id, { ...edited, scope: elsewhere.id }),
    ).toMatchObject({ ok: false, errors: { scope: expect.any(String) } });
    expect(await itemRow(item.id)).toEqual(item);
  });

  it("says what is wrong with the form, and writes nothing", async () => {
    const { org, building } = await duplex();
    const item = await createCapitalItem(org.id, building.id);

    expect(
      await updateCapitalItem(item.id, {
        ...edited,
        installYear: String(thisYear + 1),
        expectedLife: "0",
      }),
    ).toEqual({
      ok: false,
      errors: {
        installYear: "Enter this year or an earlier one.",
        expectedLife: "Enter a whole number of years, like 15.",
      },
    });
    expect(await itemRow(item.id)).toEqual(item);
  });

  it("edits an active item only, on an active building only", async () => {
    const { org, building } = await duplex();
    const replaced = await createCapitalItem(org.id, building.id);
    const successor = await createCapitalItem(org.id, building.id);
    await testDb()
      .update(capitalItems)
      .set({ status: "replaced", replacedById: successor.id })
      .where(eq(capitalItems.id, replaced.id));
    const gone = await createCapitalItem(org.id, building.id, {
      status: "removed",
    });

    expect((await updateCapitalItem(replaced.id, edited)).ok).toBe(false);
    expect((await updateCapitalItem(gone.id, edited)).ok).toBe(false);
    expect((await updateCapitalItem(successor.id, edited)).ok).toBe(true);

    await testDb()
      .update(buildings)
      .set({ status: "archived" })
      .where(eq(buildings.id, building.id));

    expect((await updateCapitalItem(successor.id, edited)).ok).toBe(false);
  });
});

describe("removeCapitalItem", () => {
  it("marks the item removed, and keeps everything else about it", async () => {
    const { org, building } = await duplex();
    const item = await createCapitalItem(org.id, building.id, {
      actualCostCents: 310_000,
      notes:
        "Cracked heat exchanger; not replaced, unit switched to mini-splits.",
    });

    expect(await removeCapitalItem(item.id)).toEqual({ ok: true });
    expect(await itemRow(item.id)).toEqual({
      ...item,
      status: "removed",
      updatedAt: expect.any(Date),
    });
  });

  it("removes an item once, and not one already replaced", async () => {
    const { org, building } = await duplex();
    const item = await createCapitalItem(org.id, building.id);
    const replaced = await createCapitalItem(org.id, building.id);
    await testDb()
      .update(capitalItems)
      .set({ status: "replaced", replacedById: item.id })
      .where(eq(capitalItems.id, replaced.id));

    expect((await removeCapitalItem(item.id)).ok).toBe(true);
    expect((await removeCapitalItem(item.id)).ok).toBe(false);
    expect((await removeCapitalItem(replaced.id)).ok).toBe(false);
    expect(await itemRow(replaced.id)).toMatchObject({ status: "replaced" });
  });

  it("removes nothing on an archived building", async () => {
    const { org, building } = await duplex();
    const item = await createCapitalItem(org.id, building.id);
    await testDb()
      .update(buildings)
      .set({ status: "archived" })
      .where(eq(buildings.id, building.id));

    expect((await removeCapitalItem(item.id)).ok).toBe(false);
    expect(await itemRow(item.id)).toEqual(item);
  });
});
