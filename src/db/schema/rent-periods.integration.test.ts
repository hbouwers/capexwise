/**
 * The parts of `rent_periods` that live in SQL: the checks that keep a period
 * on the first of its month and a payment whole, the vacant month that holds
 * no money, the key that keeps a period's building its unit's, and what a unit
 * with rent history may no longer do. `npm run typecheck` sees none of them,
 * and each is a claim `docs/data-model.md` §4 and §7 make in prose.
 *
 * The snapshot rule — a rent change after a period opens does not move it —
 * belongs to the helper that opens periods, and is tested beside it.
 */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { organizations, rentPeriods, units } from "@/db/schema";
import { testDb } from "@/test/db";
import {
  createBuilding,
  createOrganization,
  createRentPeriod,
  createUnit,
} from "@/test/factories";
import {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  rejectsWith,
  RESTRICT_VIOLATION,
  UNIQUE_VIOLATION,
} from "@/test/postgres-errors";

async function aUnit() {
  const org = await createOrganization();
  const building = await createBuilding(org.id);
  const unit = await createUnit(org.id, building.id, {
    label: "A",
    status: "occupied",
    rentCents: 230_000,
  });

  return { org, building, unit };
}

describe("rent_periods", () => {
  it("opens a period expecting rent and holding nothing received", async () => {
    const { org, building, unit } = await aUnit();
    const period = await createRentPeriod(org.id, building.id, unit.id);

    expect(period).toMatchObject({
      periodMonth: "2026-09-01",
      amountExpectedCents: 230_000,
      amountReceivedCents: null,
      receivedOn: null,
      vacant: false,
    });
  });

  it("refuses a month that is not its first day", async () => {
    const { org, building, unit } = await aUnit();

    await expect(
      createRentPeriod(org.id, building.id, unit.id, {
        periodMonth: "2026-09-14",
      }),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
  });

  it("holds one period per unit per month", async () => {
    const { org, building, unit } = await aUnit();
    await createRentPeriod(org.id, building.id, unit.id);

    await expect(
      createRentPeriod(org.id, building.id, unit.id),
    ).rejects.toSatisfy(rejectsWith(UNIQUE_VIOLATION));

    // The next month is another period.
    await createRentPeriod(org.id, building.id, unit.id, {
      periodMonth: "2026-10-01",
    });
  });

  it("refuses an amount received without its date, and a date without an amount", async () => {
    const { org, building, unit } = await aUnit();

    await expect(
      createRentPeriod(org.id, building.id, unit.id, {
        amountReceivedCents: 230_000,
      }),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
    await expect(
      createRentPeriod(org.id, building.id, unit.id, {
        receivedOn: "2026-09-03",
      }),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
  });

  it("refuses a negative amount on either side", async () => {
    const { org, building, unit } = await aUnit();

    await expect(
      createRentPeriod(org.id, building.id, unit.id, {
        amountExpectedCents: -1,
      }),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
    await expect(
      createRentPeriod(org.id, building.id, unit.id, {
        amountReceivedCents: -1,
        receivedOn: "2026-09-03",
      }),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
  });

  it("refuses money received in a month the unit stood vacant", async () => {
    // #97: a vacant month expects nothing, so nothing can have arrived for it.
    const { org, building, unit } = await aUnit();
    const period = await createRentPeriod(org.id, building.id, unit.id, {
      vacant: true,
    });

    await expect(
      testDb()
        .update(rentPeriods)
        .set({ amountReceivedCents: 230_000, receivedOn: "2026-09-03" })
        .where(eq(rentPeriods.id, period.id)),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
  });

  it("refuses a period whose building is not its unit's", async () => {
    // `building_id` is stored beside the unit for the sums by building (§4),
    // and `rent_periods_unit` names both — so a period cannot be counted
    // toward a building its unit is not in, even inside one org.
    const { org, unit } = await aUnit();
    const elsewhere = await createBuilding(org.id);

    await expect(
      createRentPeriod(org.id, elsewhere.id, unit.id),
    ).rejects.toSatisfy(rejectsWith(FOREIGN_KEY_VIOLATION));
  });

  it("refuses a period on another org's unit", async () => {
    const mine = await createOrganization();
    const theirs = await aUnit();

    await expect(
      createRentPeriod(mine.id, theirs.building.id, theirs.unit.id),
    ).rejects.toSatisfy(rejectsWith(FOREIGN_KEY_VIOLATION));
  });

  it("keeps a unit with rent history from being deleted", async () => {
    // §7: it is retired instead, and its months stay attached.
    const { org, building, unit } = await aUnit();
    await createRentPeriod(org.id, building.id, unit.id);

    await expect(
      testDb().delete(units).where(eq(units.id, unit.id)),
    ).rejects.toSatisfy(rejectsWith(RESTRICT_VIOLATION));

    await testDb()
      .update(units)
      .set({ status: "retired" })
      .where(eq(units.id, unit.id));
  });

  it("keeps a unit from moving to another building while its months are there", async () => {
    // Nothing in the product moves a unit, and the key is why it cannot start
    // to: the months it collected would be counted toward a building it was
    // never in.
    const { org, building, unit } = await aUnit();
    const elsewhere = await createBuilding(org.id);
    await createRentPeriod(org.id, building.id, unit.id);

    await expect(
      testDb()
        .update(units)
        .set({ buildingId: elsewhere.id })
        .where(eq(units.id, unit.id)),
    ).rejects.toSatisfy(rejectsWith(FOREIGN_KEY_VIOLATION));
  });

  it("still purges an org whole, rent history and all", async () => {
    // The unit's `restrict` must not stall the purge (§7): the periods go in
    // the same statement as the units they hold.
    const { org, building, unit } = await aUnit();
    await createRentPeriod(org.id, building.id, unit.id, {
      amountReceivedCents: 230_000,
      receivedOn: "2026-09-03",
    });

    await testDb().delete(organizations).where(eq(organizations.id, org.id));

    expect(await testDb().select().from(rentPeriods)).toEqual([]);
    expect(await testDb().select().from(units)).toEqual([]);
  });
});
