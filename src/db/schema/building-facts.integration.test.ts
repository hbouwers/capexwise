/**
 * The parts of the building facts tables that live in SQL: the checks that
 * keep a secret sealed and an account number a stub, the references that name
 * an org, and what goes when a building, a unit or an org does.
 * `npm run typecheck` sees none of them, and each is a claim
 * `docs/data-model.md` §3 and §7 make in prose.
 */
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  buildingAccessCodes,
  buildingFacts,
  buildings,
  buildingUtilities,
  organizations,
  units,
} from "@/db/schema";
import { SEALED_BYTES } from "@/lib/access-code-cipher.mts";
import { testDb } from "@/test/db";
import {
  createAccessCode,
  createBuilding,
  createBuildingFacts,
  createContact,
  createOrganization,
  createUnit,
  createUtility,
} from "@/test/factories";
import {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  RESTRICT_VIOLATION,
  rejectsWith,
  UNIQUE_VIOLATION,
} from "@/test/postgres-errors";

async function aBuilding() {
  const org = await createOrganization();
  const building = await createBuilding(org.id);
  const unit = await createUnit(org.id, building.id, { label: "A" });

  return { org, building, unit };
}

describe("building_access_codes", () => {
  it("stores what the cipher seals", async () => {
    const { org, building } = await aBuilding();
    const code = await createAccessCode(org.id, building.id);

    expect(code.secret).toHaveLength(SEALED_BYTES);
    expect(code.keyVersion).toBe(1);
  });

  it("refuses a plaintext written straight into the column", async () => {
    // The debug-session case §3 names: `secret` is `bytea`, so a code typed
    // into it is stored as its bytes — five of them, not ninety-two.
    const { org, building } = await aBuilding();

    await expect(
      testDb().execute(sql`
        insert into building_access_codes (org_id, building_id, kind, secret, key_version)
        values (${org.id}, ${building.id}, 'door', convert_to('4417#', 'UTF8'), 1)
      `),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
  });

  it("refuses a secret one byte off the sealed length", async () => {
    const { org, building } = await aBuilding();

    for (const length of [SEALED_BYTES - 1, SEALED_BYTES + 1]) {
      await expect(
        testDb()
          .insert(buildingAccessCodes)
          .values({
            orgId: org.id,
            buildingId: building.id,
            kind: "door",
            secret: Buffer.alloc(length),
            keyVersion: 1,
          }),
      ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
    }
  });

  it("refuses a key version of zero", async () => {
    const { org, building } = await aBuilding();
    const code = await createAccessCode(org.id, building.id);

    await expect(
      testDb()
        .update(buildingAccessCodes)
        .set({ keyVersion: 0 })
        .where(eq(buildingAccessCodes.id, code.id)),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
  });

  it("refuses a code on another org's building or unit", async () => {
    // Sealed for `mine`, pointing at `theirs`: the references name the org,
    // so neither row can exist.
    const mine = await createOrganization();
    const theirs = await aBuilding();
    const building = await createBuilding(mine.id);

    await expect(
      createAccessCode(mine.id, theirs.building.id),
    ).rejects.toSatisfy(rejectsWith(FOREIGN_KEY_VIOLATION));
    await expect(
      createAccessCode(mine.id, building.id, { unitId: theirs.unit.id }),
    ).rejects.toSatisfy(rejectsWith(FOREIGN_KEY_VIOLATION));
  });
});

describe("building_utilities", () => {
  it("defaults to owner-paid and the whole building", async () => {
    const { org, building } = await aBuilding();
    const utility = await createUtility(org.id, building.id, {
      paidBy: undefined,
    });

    expect(utility.paidBy).toBe("owner");
    expect(utility.unitId).toBeNull();
  });

  it("holds an account reference to four characters", async () => {
    // A full account number is refused rather than stored — the custody line
    // ADR-0008 puts in the schema.
    const { org, building } = await aBuilding();

    await expect(
      createUtility(org.id, building.id, { accountRef: "0012345678" }),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
    await expect(
      createUtility(org.id, building.id, { accountRef: "4192" }),
    ).resolves.toMatchObject({ accountRef: "4192" });
  });

  it("refuses a payer it does not know, and a negative bill", async () => {
    const { org, building } = await aBuilding();

    await expect(
      createUtility(org.id, building.id, { paidBy: "landlord" as "owner" }),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
    await expect(
      createUtility(org.id, building.id, { avgMonthlyCents: -1 }),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
  });

  it("refuses a utility on another org's building, unit or contact", async () => {
    const mine = await aBuilding();
    const theirs = await aBuilding();
    const contact = await createContact(theirs.org.id);

    await expect(
      createUtility(mine.org.id, theirs.building.id),
    ).rejects.toSatisfy(rejectsWith(FOREIGN_KEY_VIOLATION));
    await expect(
      createUtility(mine.org.id, mine.building.id, {
        unitId: theirs.unit.id,
      }),
    ).rejects.toSatisfy(rejectsWith(FOREIGN_KEY_VIOLATION));
    await expect(
      createUtility(mine.org.id, mine.building.id, { contactId: contact.id }),
    ).rejects.toSatisfy(rejectsWith(FOREIGN_KEY_VIOLATION));
  });
});

describe("building_facts", () => {
  it("is one row per building", async () => {
    const { org, building } = await aBuilding();
    await createBuildingFacts(org.id, building.id);

    await expect(createBuildingFacts(org.id, building.id)).rejects.toSatisfy(
      rejectsWith(UNIQUE_VIOLATION),
    );
  });

  it("refuses a day it does not know", async () => {
    const { org, building } = await aBuilding();

    await expect(
      createBuildingFacts(org.id, building.id, {
        recyclingDay: "thursday" as "thu",
      }),
    ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
  });

  it("refuses facts for another org's building", async () => {
    const mine = await createOrganization();
    const theirs = await aBuilding();

    await expect(
      createBuildingFacts(mine.id, theirs.building.id),
    ).rejects.toSatisfy(rejectsWith(FOREIGN_KEY_VIOLATION));
  });

  it("moves updated_at when a column changes, and not otherwise", async () => {
    // The trigger `0015` adds; `buildings.integration.test.ts` has the pattern.
    const LONG_AGO = new Date("2020-01-01T00:00:00.000Z");
    const { org, building } = await aBuilding();
    await createBuildingFacts(org.id, building.id, { updatedAt: LONG_AGO });

    const updatedAt = async () =>
      (
        await testDb()
          .select({ updatedAt: buildingFacts.updatedAt })
          .from(buildingFacts)
          .where(eq(buildingFacts.buildingId, building.id))
      )[0]?.updatedAt.getTime();

    await testDb()
      .update(buildingFacts)
      .set({ trashDay: "thu" })
      .where(eq(buildingFacts.buildingId, building.id));
    expect(await updatedAt()).toBe(LONG_AGO.getTime());

    await testDb()
      .update(buildingFacts)
      .set({ trashDay: "fri" })
      .where(eq(buildingFacts.buildingId, building.id));
    expect(await updatedAt()).toBeGreaterThan(LONG_AGO.getTime());
  });
});

describe("deleting", () => {
  it("takes a unit's codes with it, and keeps its utilities until they move", async () => {
    // §3: a code to a door that no longer exists opens nothing, so it goes;
    // an account on a meter is somewhere to move first, so the unit waits.
    const { org, building, unit } = await aBuilding();
    const code = await createAccessCode(org.id, building.id, {
      unitId: unit.id,
    });

    await testDb().delete(units).where(eq(units.id, unit.id));

    expect(
      await testDb()
        .select()
        .from(buildingAccessCodes)
        .where(eq(buildingAccessCodes.id, code.id)),
    ).toEqual([]);

    const other = await createUnit(org.id, building.id, { label: "B" });
    await createUtility(org.id, building.id, { unitId: other.id });

    await expect(
      testDb().delete(units).where(eq(units.id, other.id)),
    ).rejects.toSatisfy(rejectsWith(RESTRICT_VIOLATION));
  });

  it("keeps a contact that a utility names", async () => {
    // §7: archived, not deleted — and a true delete only of a contact nothing
    // references. Nothing in the product deletes one; this is what would stop
    // it quietly unlinking the plow.
    const { org, building } = await aBuilding();
    const contact = await createContact(org.id);
    await createUtility(org.id, building.id, {
      kind: "snow",
      contactId: contact.id,
    });

    await expect(
      testDb().execute(sql`delete from contacts where id = ${contact.id}`),
    ).rejects.toSatisfy(rejectsWith(RESTRICT_VIOLATION));
  });

  it("takes the facts with a building nothing else hangs off", async () => {
    // The typo case. A building with a unit is refused by the unit, as
    // before; facts, utilities and codes are the building's own, and go.
    const org = await createOrganization();
    const building = await createBuilding(org.id);
    await createBuildingFacts(org.id, building.id);
    await createUtility(org.id, building.id);
    await createAccessCode(org.id, building.id);

    await testDb().delete(buildings).where(eq(buildings.id, building.id));

    expect(await testDb().select().from(buildingFacts)).toEqual([]);
    expect(await testDb().select().from(buildingUtilities)).toEqual([]);
    expect(await testDb().select().from(buildingAccessCodes)).toEqual([]);
  });

  it("still purges an org whole, facts and all", async () => {
    // The purge cascades into every table at once. Two of the references
    // above are `restrict` — a utility's unit, a utility's contact — and
    // neither may stop it: the rows they protect are going in the same
    // statement. `buildings.integration.test.ts` has the same case for units.
    const { org, building, unit } = await aBuilding();
    const contact = await createContact(org.id);
    await createBuildingFacts(org.id, building.id);
    await createUtility(org.id, building.id, {
      unitId: unit.id,
      contactId: contact.id,
    });
    await createAccessCode(org.id, building.id, { unitId: unit.id });

    await testDb().delete(organizations).where(eq(organizations.id, org.id));

    expect(await testDb().select().from(buildingFacts)).toEqual([]);
    expect(await testDb().select().from(buildingUtilities)).toEqual([]);
    expect(await testDb().select().from(buildingAccessCodes)).toEqual([]);
    expect(await testDb().select().from(units)).toEqual([]);
  });
});
