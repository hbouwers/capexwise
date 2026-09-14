/**
 * The parts of `buildings` and `units` that live in SQL: the basis rule, the
 * checks, the unit-label uniqueness and the references. `npm run typecheck`
 * sees none of them, and every one is a claim `docs/data-model.md` §3 and §7
 * make in prose. The pattern is `organizations.integration.test.ts`.
 */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { buildings, organizations, units } from "@/db/schema";
import { testDb } from "@/test/db";
import {
  createBuilding,
  createOrganization,
  createUnit,
} from "@/test/factories";
import {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  RESTRICT_VIOLATION,
  rejectsWith,
  UNIQUE_VIOLATION,
} from "@/test/postgres-errors";

/**
 * $250,000 with $4,200 of capitalised closing costs, $46,000 of it land. The
 * building's basis is what is left, so the four add up.
 */
const BASIS = {
  purchasePriceCents: 25_000_000,
  closingCostsCents: 420_000,
  landBasisCents: 4_600_000,
  buildingBasisCents: 20_820_000,
};

describe("buildings", () => {
  it("starts active, in the US, with no basis", async () => {
    const org = await createOrganization();
    const building = await createBuilding(org.id);

    expect(building.status).toBe("active");
    expect(building.country).toBe("US");
    expect(building.purchasePriceCents).toBeNull();
    expect(building.buildingBasisCents).toBeNull();
  });

  describe("the basis, all or nothing", () => {
    it("accepts a whole basis that adds up", async () => {
      const org = await createOrganization();
      const building = await createBuilding(org.id, BASIS);

      expect(building.buildingBasisCents).toBe(20_820_000);
    });

    it("accepts a basis with no closing costs, where land and building make the price", async () => {
      const org = await createOrganization();
      const building = await createBuilding(org.id, {
        ...BASIS,
        closingCostsCents: null,
        buildingBasisCents: 20_400_000,
      });

      expect(building.closingCostsCents).toBeNull();
    });

    it("refuses a price without its split", async () => {
      // The row that would silently depreciate land.
      const org = await createOrganization();

      await expect(
        createBuilding(org.id, { purchasePriceCents: 25_000_000 }),
      ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
    });

    it("refuses any one of price, land and building missing", async () => {
      const org = await createOrganization();

      for (const missing of [
        "purchasePriceCents",
        "landBasisCents",
        "buildingBasisCents",
      ]) {
        await expect(
          createBuilding(org.id, { ...BASIS, [missing]: null }),
        ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
      }
    });

    it("refuses a split that is a cent off", async () => {
      const org = await createOrganization();

      await expect(
        createBuilding(org.id, { ...BASIS, buildingBasisCents: 20_820_001 }),
      ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
    });

    it("counts closing costs into the basis, not beside it", async () => {
      // Land and building summing to the price alone is wrong once there are
      // capitalised closing costs: they are part of what is depreciated.
      const org = await createOrganization();

      await expect(
        createBuilding(org.id, { ...BASIS, buildingBasisCents: 20_400_000 }),
      ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
    });

    it("refuses a negative figure even when the arithmetic works", async () => {
      // Land above the price makes the building's share negative, and the sum
      // still balances. The sign check is what refuses it.
      const org = await createOrganization();

      await expect(
        createBuilding(org.id, {
          purchasePriceCents: 10_000_000,
          closingCostsCents: null,
          landBasisCents: 12_000_000,
          buildingBasisCents: -2_000_000,
        }),
      ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
    });

    it("refuses a split method it does not know", async () => {
      const org = await createOrganization();

      await expect(
        createBuilding(org.id, {
          ...BASIS,
          basisSplitMethod: "vibes" as "manual",
        }),
      ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
    });
  });

  it("refuses a build year nobody could mean", async () => {
    const org = await createOrganization();

    await expect(createBuilding(org.id, { buildYear: 192 })).rejects.toSatisfy(
      rejectsWith(CHECK_VIOLATION),
    );
  });

  it("moves updated_at when a column changes, and not otherwise", async () => {
    // The trigger `0010` adds. The organizations test explains the fixed date.
    const LONG_AGO = new Date("2020-01-01T00:00:00.000Z");
    const org = await createOrganization();
    const building = await createBuilding(org.id, { updatedAt: LONG_AGO });

    await testDb()
      .update(buildings)
      .set({ city: building.city })
      .where(eq(buildings.id, building.id));

    const [unchanged] = await testDb()
      .select({ updatedAt: buildings.updatedAt })
      .from(buildings)
      .where(eq(buildings.id, building.id));

    expect(unchanged?.updatedAt.getTime()).toBe(LONG_AGO.getTime());

    await testDb()
      .update(buildings)
      .set({ label: "The Delaware Street duplex" })
      .where(eq(buildings.id, building.id));

    const [changed] = await testDb()
      .select({ updatedAt: buildings.updatedAt })
      .from(buildings)
      .where(eq(buildings.id, building.id));

    expect(changed?.updatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
  });
});

describe("units", () => {
  it("starts vacant with no rent", async () => {
    const org = await createOrganization();
    const building = await createBuilding(org.id);
    const unit = await createUnit(org.id, building.id);

    expect(unit.status).toBe("vacant");
    expect(unit.rentCents).toBeNull();
  });

  it("reads a half bathroom back exactly", async () => {
    const org = await createOrganization();
    const building = await createBuilding(org.id);
    const unit = await createUnit(org.id, building.id, { bathrooms: "1.5" });

    expect(unit.bathrooms).toBe("1.5");
  });

  it("refuses a negative rent", async () => {
    const org = await createOrganization();
    const building = await createBuilding(org.id);

    await expect(
      createUnit(org.id, building.id, { rentCents: -1 }),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
  });

  it("refuses two units with one label in a building", async () => {
    const org = await createOrganization();
    const building = await createBuilding(org.id);
    await createUnit(org.id, building.id, { label: "A" });

    await expect(
      createUnit(org.id, building.id, { label: "A" }),
    ).rejects.toSatisfy(rejectsWith(UNIQUE_VIOLATION));
  });

  it("lets every duplex have its own unit A", async () => {
    const org = await createOrganization();
    const first = await createBuilding(org.id);
    const second = await createBuilding(org.id);

    await createUnit(org.id, first.id, { label: "A" });
    await createUnit(org.id, second.id, { label: "A" });

    expect(await testDb().select().from(units)).toHaveLength(2);
  });

  it("refuses a unit in another org's building", async () => {
    // `units_building` names the org as well as the building. With the plain
    // `building_id` reference this would be stored: the harness reads past
    // row-level security, and so does every foreign-key check, scoped role or
    // not. The isolation test makes the same attempt through a scoped handle.
    const mine = await createOrganization();
    const theirs = await createOrganization();
    const building = await createBuilding(theirs.id);

    await expect(createUnit(mine.id, building.id)).rejects.toSatisfy(
      rejectsWith(FOREIGN_KEY_VIOLATION),
    );
  });
});

describe("deleting", () => {
  it("deletes a building nothing hangs off — the typo case", async () => {
    const org = await createOrganization();
    const building = await createBuilding(org.id);

    await testDb().delete(buildings).where(eq(buildings.id, building.id));

    expect(await testDb().select().from(buildings)).toEqual([]);
  });

  it("refuses to delete a building that has units", async () => {
    // §7: a building with anything attached is archived, not deleted. Restrict
    // raises its own code rather than the generic foreign-key one — the
    // postgres-errors module says why the distinction is worth asserting.
    const org = await createOrganization();
    const building = await createBuilding(org.id);
    await createUnit(org.id, building.id);

    await expect(
      testDb().delete(buildings).where(eq(buildings.id, building.id)),
    ).rejects.toSatisfy(rejectsWith(RESTRICT_VIOLATION));
  });

  it("still purges an org whole, buildings, units and all", async () => {
    // The org purge (§7) cascades into both tables at once, and the building's
    // `restrict` must not stop it: the units are going in the same statement.
    // A restrict that fired before the cascade reached the units would make
    // every org with a building unpurgeable, and nothing else would notice
    // until the first purge ran.
    const org = await createOrganization();
    const building = await createBuilding(org.id);
    await createUnit(org.id, building.id);
    await createUnit(org.id, building.id);

    await testDb().delete(organizations).where(eq(organizations.id, org.id));

    expect(await testDb().select().from(buildings)).toEqual([]);
    expect(await testDb().select().from(units)).toEqual([]);
  });
});
