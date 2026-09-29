/**
 * The parts of the capital items' tables that live in SQL: the catalogue the
 * migrations seed, the checks that keep an audited item dated and a shared
 * item's split meaningful, a replacement that is a row of its own, the rule
 * that an explicit split sums to the whole, and what equipment holds in
 * place. `npm run typecheck` sees none of them, and each is a claim
 * `docs/data-model.md` §5 and §7 make in prose.
 *
 * The copying of the catalogue's defaults and the shape of a replacement
 * belong to the actions that do them, and are tested beside them.
 */
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  capitalItemAllocations,
  capitalItems,
  capitalItemTypes,
  units,
} from "@/db/schema";
import { testDb } from "@/test/db";
import {
  createBuilding,
  createCapitalItem,
  createOrganization,
  createUnit,
  splitCapitalItem,
} from "@/test/factories";
import {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  rejectsWith,
  RESTRICT_VIOLATION,
} from "@/test/postgres-errors";

/** A duplex: one building, units A and B. */
async function duplex() {
  const org = await createOrganization();
  const building = await createBuilding(org.id);
  const a = await createUnit(org.id, building.id, { label: "A" });
  const b = await createUnit(org.id, building.id, { label: "B" });

  return { org, building, a, b };
}

/**
 * Which constraint a violation named, through whatever wrapped it. The sum
 * rule is a trigger rather than a constraint, and raises under a constraint's
 * name so that a test can tell its two refusals apart — both are
 * `CHECK_VIOLATION`.
 */
function constraintOf(error: unknown): string | undefined {
  let current: unknown = error;

  while (current instanceof Error) {
    const { constraint } = current as { constraint?: unknown };
    if (typeof constraint === "string") return constraint;

    current = current.cause;
  }

  return undefined;
}

function violates(constraint: string): (error: unknown) => boolean {
  return (error) =>
    rejectsWith(CHECK_VIOLATION)(error) && constraintOf(error) === constraint;
}

describe("capital_item_types", () => {
  it("holds the checklist's catalogue, in its five groups and its order", async () => {
    const types = await testDb()
      .select()
      .from(capitalItemTypes)
      .orderBy(asc(capitalItemTypes.sortOrder));

    expect(types).toHaveLength(27);
    // The groups arrive in the modal's order, each in one run.
    expect([...new Set(types.map((type) => type.itemGroup))]).toEqual([
      "kitchen",
      "laundry",
      "hvac_water",
      "envelope",
      "interior_systems",
    ]);
    expect(new Set(types.map((type) => type.sortOrder)).size).toBe(27);
    // A default is never zero: an item that forecasts nothing, or never wears
    // out, would be a catalogue typo rather than a figure.
    expect(
      types.filter(
        (type) => type.defaultLifeYears < 1 || type.defaultCostCents < 1,
      ),
    ).toEqual([]);
    expect(new Set(types.map((type) => type.defaultsUpdatedAt))).toEqual(
      new Set(["2026-09-15"]),
    );
  });

  it("recovers appliances and carpet over five years, and the rest with the building", async () => {
    // #144, decision 1. A type on the wrong schedule is a wrong deduction
    // every year of its life, so the list is spelled out rather than counted.
    const types = await testDb()
      .select({ slug: capitalItemTypes.slug })
      .from(capitalItemTypes)
      .where(eq(capitalItemTypes.recoveryClass, "five_year"))
      .orderBy(asc(capitalItemTypes.sortOrder));

    expect(types.map((type) => type.slug)).toEqual([
      "refrigerator",
      "range",
      "dishwasher",
      "microwave-hood",
      "garbage-disposal",
      "washer",
      "dryer",
      "carpet",
    ]);
  });

  it("keeps a type anybody has added", async () => {
    // §7: reference data in use is not deleted. Refused, so the catalogue the
    // rest of the suite reads is not touched.
    const { org, building } = await duplex();
    await createCapitalItem(org.id, building.id);

    await expect(
      testDb()
        .delete(capitalItemTypes)
        .where(eq(capitalItemTypes.slug, "furnace-gas")),
    ).rejects.toSatisfy(rejectsWith(RESTRICT_VIOLATION));
  });
});

describe("capital_items", () => {
  it("adds a shared item, estimated, divided by unit count", async () => {
    const { org, building } = await duplex();
    const item = await createCapitalItem(org.id, building.id);

    expect(item).toMatchObject({
      unitId: null,
      confidence: "estimated",
      installDate: null,
      status: "active",
      allocation: "by_unit_count",
      replacedById: null,
    });
  });

  it("requires an audited item's date, and one inside its install year", async () => {
    const { org, building } = await duplex();

    await expect(
      createCapitalItem(org.id, building.id, { confidence: "audited" }),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
    await expect(
      createCapitalItem(org.id, building.id, {
        confidence: "audited",
        installYear: 2009,
        installDate: "2010-01-04",
      }),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));

    await createCapitalItem(org.id, building.id, {
      confidence: "audited",
      installYear: 2009,
      installDate: "2009-10-12",
    });
  });

  it("divides only a shared item", async () => {
    // A unit-scoped item's unit already says whose it is.
    const { org, building, a } = await duplex();

    for (const allocation of ["by_unit_count", "explicit"] as const) {
      await expect(
        createCapitalItem(org.id, building.id, { unitId: a.id, allocation }),
      ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
    }

    const own = await createCapitalItem(org.id, building.id, {
      unitId: a.id,
      typeSlug: "refrigerator",
    });
    expect(own.allocation).toBe("building_only");
  });

  it("refuses a unit that is not in the item's building", async () => {
    // `capital_items_unit` names the building as well as the unit: an item
    // counted toward one building's forecast with a unit from another.
    const { org, building } = await duplex();
    const elsewhere = await createBuilding(org.id);
    const theirs = await createUnit(org.id, elsewhere.id, { label: "A" });

    await expect(
      createCapitalItem(org.id, building.id, { unitId: theirs.id }),
    ).rejects.toSatisfy(rejectsWith(FOREIGN_KEY_VIOLATION));
  });

  it("marks an item replaced only with the row that replaced it", async () => {
    const { org, building } = await duplex();
    const old = await createCapitalItem(org.id, building.id);
    const successor = await createCapitalItem(org.id, building.id, {
      installYear: 2026,
    });

    // Replaced with nothing after it, and a successor on an active item.
    await expect(
      testDb()
        .update(capitalItems)
        .set({ status: "replaced" })
        .where(eq(capitalItems.id, old.id)),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
    await expect(
      testDb()
        .update(capitalItems)
        .set({ replacedById: successor.id })
        .where(eq(capitalItems.id, old.id)),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
    // Nor by itself.
    await expect(
      testDb()
        .update(capitalItems)
        .set({ status: "replaced", replacedById: old.id })
        .where(eq(capitalItems.id, old.id)),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));

    await testDb()
      .update(capitalItems)
      .set({ status: "replaced", replacedById: successor.id })
      .where(eq(capitalItems.id, old.id));
  });

  it("refuses a replacement from another building", async () => {
    const { org, building } = await duplex();
    const elsewhere = await createBuilding(org.id);
    const old = await createCapitalItem(org.id, building.id);
    const theirs = await createCapitalItem(org.id, elsewhere.id);

    await expect(
      testDb()
        .update(capitalItems)
        .set({ status: "replaced", replacedById: theirs.id })
        .where(eq(capitalItems.id, old.id)),
    ).rejects.toSatisfy(rejectsWith(FOREIGN_KEY_VIOLATION));
  });

  it("keeps a replacement while the row it replaced points at it", async () => {
    // The old row's history needs its successor; undoing a replacement puts
    // the old row back first.
    const { org, building } = await duplex();
    const old = await createCapitalItem(org.id, building.id);
    const successor = await createCapitalItem(org.id, building.id, {
      installYear: 2026,
    });
    await testDb()
      .update(capitalItems)
      .set({ status: "replaced", replacedById: successor.id })
      .where(eq(capitalItems.id, old.id));

    await expect(
      testDb().delete(capitalItems).where(eq(capitalItems.id, successor.id)),
    ).rejects.toSatisfy(rejectsWith(RESTRICT_VIOLATION));
  });

  it("holds its unit in place", async () => {
    // §7: a unit with equipment is retired, never deleted.
    const { org, building, a } = await duplex();
    await createCapitalItem(org.id, building.id, { unitId: a.id });

    await expect(
      testDb().delete(units).where(eq(units.id, a.id)),
    ).rejects.toSatisfy(rejectsWith(RESTRICT_VIOLATION));
  });
});

describe("capital_item_allocations", () => {
  it("holds an explicit split that sums to the whole", async () => {
    const { org, building, a, b } = await duplex();
    const item = await createCapitalItem(org.id, building.id);

    const shares = await splitCapitalItem(org.id, building.id, item.id, [
      { unitId: a.id, shareBps: 6000 },
      { unitId: b.id, shareBps: 4000 },
    ]);

    expect(shares.map((share) => share.shareBps)).toEqual([6000, 4000]);
  });

  it("refuses a split that falls short of the whole, at commit", async () => {
    const { org, building, a } = await duplex();
    const item = await createCapitalItem(org.id, building.id);

    await expect(
      splitCapitalItem(org.id, building.id, item.id, [
        { unitId: a.id, shareBps: 6000 },
      ]),
    ).rejects.toSatisfy(violates("capital_item_allocations_sum_to_whole"));

    // Rolled back whole: the item is not left explicit with no shares.
    const [after] = await testDb()
      .select({ allocation: capitalItems.allocation })
      .from(capitalItems)
      .where(eq(capitalItems.id, item.id));
    expect(after?.allocation).toBe("by_unit_count");
  });

  it("refuses an item made explicit with no shares at all", async () => {
    const { org, building } = await duplex();
    const item = await createCapitalItem(org.id, building.id);

    await expect(
      testDb()
        .update(capitalItems)
        .set({ allocation: "explicit" })
        .where(eq(capitalItems.id, item.id)),
    ).rejects.toSatisfy(violates("capital_item_allocations_sum_to_whole"));
  });

  it("refuses a share changed, or taken away, without the others", async () => {
    const { org, building, a, b } = await duplex();
    const item = await createCapitalItem(org.id, building.id);
    await splitCapitalItem(org.id, building.id, item.id, [
      { unitId: a.id, shareBps: 6000 },
      { unitId: b.id, shareBps: 4000 },
    ]);

    await expect(
      testDb()
        .update(capitalItemAllocations)
        .set({ shareBps: 5000 })
        .where(eq(capitalItemAllocations.unitId, a.id)),
    ).rejects.toSatisfy(violates("capital_item_allocations_sum_to_whole"));
    await expect(
      testDb()
        .delete(capitalItemAllocations)
        .where(eq(capitalItemAllocations.unitId, b.id)),
    ).rejects.toSatisfy(violates("capital_item_allocations_sum_to_whole"));

    // Both together, in one transaction, is a new split and is fine.
    await testDb().transaction(async (tx) => {
      await tx
        .update(capitalItemAllocations)
        .set({ shareBps: 5000 })
        .where(eq(capitalItemAllocations.unitId, a.id));
      await tx
        .update(capitalItemAllocations)
        .set({ shareBps: 5000 })
        .where(eq(capitalItemAllocations.unitId, b.id));
    });
  });

  it("gives shares only to an item split explicitly", async () => {
    const { org, building, a, b } = await duplex();
    const item = await createCapitalItem(org.id, building.id);

    // Shares on an item divided by unit count would be a second rule that
    // nothing reads.
    await expect(
      testDb().insert(capitalItemAllocations).values({
        orgId: org.id,
        buildingId: building.id,
        capitalItemId: item.id,
        unitId: a.id,
        shareBps: 10_000,
      }),
    ).rejects.toSatisfy(violates("capital_item_allocations_explicit_only"));

    // And going back to unit count means the shares go with it.
    await splitCapitalItem(org.id, building.id, item.id, [
      { unitId: a.id, shareBps: 5000 },
      { unitId: b.id, shareBps: 5000 },
    ]);
    await expect(
      testDb()
        .update(capitalItems)
        .set({ allocation: "by_unit_count" })
        .where(eq(capitalItems.id, item.id)),
    ).rejects.toSatisfy(violates("capital_item_allocations_explicit_only"));

    await testDb().transaction(async (tx) => {
      await tx
        .delete(capitalItemAllocations)
        .where(eq(capitalItemAllocations.capitalItemId, item.id));
      await tx
        .update(capitalItems)
        .set({ allocation: "by_unit_count" })
        .where(eq(capitalItems.id, item.id));
    });
  });

  it("refuses a share for a unit in another building", async () => {
    const { org, building, a } = await duplex();
    const elsewhere = await createBuilding(org.id);
    const theirs = await createUnit(org.id, elsewhere.id, { label: "B" });
    const item = await createCapitalItem(org.id, building.id);

    await expect(
      splitCapitalItem(org.id, building.id, item.id, [
        { unitId: a.id, shareBps: 5000 },
        { unitId: theirs.id, shareBps: 5000 },
      ]),
    ).rejects.toSatisfy(rejectsWith(FOREIGN_KEY_VIOLATION));
  });

  it("refuses a share outside 0 to 10000", async () => {
    const { org, building, a, b } = await duplex();
    const item = await createCapitalItem(org.id, building.id);

    await expect(
      splitCapitalItem(org.id, building.id, item.id, [
        { unitId: a.id, shareBps: 12_000 },
        { unitId: b.id, shareBps: -2000 },
      ]),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
  });

  it("holds a unit with a share in place, and goes with its item", async () => {
    const { org, building, a, b } = await duplex();
    const item = await createCapitalItem(org.id, building.id);
    await splitCapitalItem(org.id, building.id, item.id, [
      { unitId: a.id, shareBps: 5000 },
      { unitId: b.id, shareBps: 5000 },
    ]);

    // A cascade would take one share out and leave the split short.
    await expect(
      testDb().delete(units).where(eq(units.id, b.id)),
    ).rejects.toSatisfy(rejectsWith(RESTRICT_VIOLATION));

    // The item itself — nothing refers to it yet — takes its shares along,
    // and the sum rule has nothing left to judge.
    await testDb().delete(capitalItems).where(eq(capitalItems.id, item.id));
    expect(
      await testDb()
        .select()
        .from(capitalItemAllocations)
        .where(eq(capitalItemAllocations.capitalItemId, item.id)),
    ).toEqual([]);
  });
});
