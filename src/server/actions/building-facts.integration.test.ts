/**
 * What the facts card's actions do inside one org: a save that seals its codes
 * and reconciles its rows, a reveal that opens one code and records it, and the
 * building form's unit removal now that a utility or a code can hang off a
 * unit. The cross-org half is the isolation test's.
 *
 * Driven as the page drives them — a signed session, then the action — as
 * `contacts.integration.test.ts` does, whose session setup this repeats.
 *
 * The log is watched throughout. **No line may carry a code**, which is the
 * one claim here that nothing else would notice breaking.
 */
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildingAccessCodes,
  buildingFacts,
  buildingUtilities,
  units,
} from "@/db/schema";
import { openAccessCode, parseKeyring } from "@/lib/access-code-cipher.mts";
import {
  buildingFactsFields,
  type BuildingFactsFields,
  emptyAccessCodeFields,
  emptyUtilityFields,
} from "@/lib/building-facts-form";
import { buildingFields } from "@/lib/building-form";
import { UNREADABLE_FORM } from "@/lib/forms";
import { applicationDatabaseUrl, testDb } from "@/test/db";
import {
  createAccessCode,
  createBuilding,
  createBuildingFacts,
  createContact,
  createMembership,
  createOrganization,
  createUnit,
  createUser,
  createUtility,
  TEST_ACCESS_CODE_KEYS,
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
process.env.ACCESS_CODE_KEYS = TEST_ACCESS_CODE_KEYS;

// Dynamic, and after the assignments above, for the reason the isolation test
// gives.
const { getAuth } = await import("@/server/auth");
const { revealAccessCode, saveBuildingFacts } =
  await import("@/server/actions/building-facts");
const { updateBuilding } = await import("@/server/actions/buildings");
const { getBuildingFacts } = await import("@/server/queries/building-facts");

const keyring = parseKeyring(TEST_ACCESS_CODE_KEYS);

/**
 * Every line `console.info` was handed. The codes these tests type all carry
 * a `#`, which is what makes "the log does not contain the code" a test of
 * the log: a line is ids and a timestamp, all hex digits and dashes, so a
 * digits-only code turns up inside one sooner or later — `3333` did, in an
 * org's UUID in CI — and the check fails on no leak at all.
 */
let logged: string[] = [];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, "info").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Every access-code record written since the test began, parsed. */
function records() {
  return logged
    .map((line) => JSON.parse(line) as Record<string, string>)
    .filter((line) => line.log === "access_code");
}

/** A duplex with two units, its owner signed in as the requests below. */
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

  const building = await createBuilding(org.id);
  const a = await createUnit(org.id, building.id, { label: "A" });
  const b = await createUnit(org.id, building.id, { label: "B" });

  return { org, owner, building, a, b };
}

async function editorFor(buildingId: string): Promise<BuildingFactsFields> {
  return buildingFactsFields(await getBuildingFacts(buildingId));
}

async function codeRow(id: string) {
  const [row] = await testDb()
    .select()
    .from(buildingAccessCodes)
    .where(eq(buildingAccessCodes.id, id));

  return row;
}

describe("saveBuildingFacts", () => {
  it("writes the days, the utilities and a sealed code", async () => {
    const { org, building, a } = await duplex();
    const plow = await createContact(org.id, { name: "Ray Okonkwo" });

    const result = await saveBuildingFacts(building.id, {
      ...(await editorFor(building.id)),
      trashDay: "thu",
      recyclingDay: "tue",
      recyclingNote: "every other week",
      accessCodes: [
        {
          ...emptyAccessCodeFields(),
          kind: "lockbox",
          label: "Basement",
          code: "2280#",
        },
      ],
      utilities: [
        {
          ...emptyUtilityFields("electric"),
          unitId: a.id,
          providerName: "AES Indiana",
          accountRef: "4192",
          paidBy: "tenant",
          avgMonthly: "$92",
        },
        { ...emptyUtilityFields("snow"), contactId: plow.id },
      ],
    });

    expect(result).toEqual({ ok: true });

    const facts = await getBuildingFacts(building.id);
    expect(facts).toMatchObject({
      trashDay: "thu",
      recyclingDay: "tue",
      recyclingNote: "every other week",
      utilities: [
        {
          kind: "electric",
          unitId: a.id,
          accountRef: "4192",
          paidBy: "tenant",
          avgMonthlyCents: 9_200,
          contact: null,
        },
        {
          kind: "snow",
          providerName: null,
          contact: { id: plow.id, name: "Ray Okonkwo" },
        },
      ],
      accessCodes: [
        {
          kind: "lockbox",
          label: "Basement",
          unitId: null,
          lastRotatedAt: null,
        },
      ],
    });

    // Sealed for this org, and opening to what was typed.
    const [summary] = facts.accessCodes;
    const row = await codeRow(summary!.id);
    expect(row?.secret).toHaveLength(92);
    expect(row?.secret.includes(Buffer.from("2280#"))).toBe(false);
    expect(openAccessCode(keyring, org.id, row!)).toBe("2280#");

    expect(records()).toMatchObject([
      { event: "added", access_code_id: summary!.id, building_id: building.id },
    ]);
    expect(logged.join("\n")).not.toContain("2280#");
    expect(logged.join("\n")).not.toContain("Basement");
  });

  it("keeps a code whose field is left empty, and re-seals one that is typed", async () => {
    const { org, building } = await duplex();
    const kept = await createAccessCode(org.id, building.id, { code: "1111#" });
    const replaced = await createAccessCode(org.id, building.id, {
      code: "2222#",
    });

    const editor = await editorFor(building.id);
    const result = await saveBuildingFacts(building.id, {
      ...editor,
      accessCodes: editor.accessCodes.map((row) =>
        row.id === replaced.id ? { ...row, code: "3333#" } : row,
      ),
    });

    expect(result).toEqual({ ok: true });

    const keptRow = await codeRow(kept.id);
    expect(keptRow?.secret).toEqual(kept.secret);
    expect(keptRow?.lastRotatedAt).toBeNull();

    const replacedRow = await codeRow(replaced.id);
    expect(openAccessCode(keyring, org.id, replacedRow!)).toBe("3333#");
    // The code at the lock changed, and the row says when.
    expect(replacedRow?.lastRotatedAt).toBeInstanceOf(Date);

    expect(records().map((line) => [line.event, line.access_code_id])).toEqual([
      ["replaced", replaced.id],
    ]);
    expect(logged.join("\n")).not.toMatch(/1111#|2222#|3333#/);
  });

  it("removes what the editor removed, and records a removed code", async () => {
    const { org, building } = await duplex();
    const code = await createAccessCode(org.id, building.id);
    await createUtility(org.id, building.id);

    const result = await saveBuildingFacts(building.id, {
      ...(await editorFor(building.id)),
      accessCodes: [],
      utilities: [],
    });

    expect(result).toEqual({ ok: true });
    expect(await testDb().select().from(buildingAccessCodes)).toEqual([]);
    expect(await testDb().select().from(buildingUtilities)).toEqual([]);
    expect(records().map((line) => [line.event, line.access_code_id])).toEqual([
      ["removed", code.id],
    ]);
  });

  it("clears the days without deleting the row, and writes none for nothing", async () => {
    const { org, building } = await duplex();

    // Nothing recorded, nothing saved: no row appears.
    await saveBuildingFacts(building.id, await editorFor(building.id));
    expect(await testDb().select().from(buildingFacts)).toEqual([]);

    await createBuildingFacts(org.id, building.id, { trashDay: "mon" });
    await saveBuildingFacts(building.id, {
      ...(await editorFor(building.id)),
      trashDay: "",
    });

    expect(await testDb().select().from(buildingFacts)).toMatchObject([
      { buildingId: building.id, trashDay: null },
    ]);
  });

  it("refuses another building's unit or code, and writes nothing", async () => {
    // Both this org's, and neither this building's: an id from the browser
    // is a lookup into this building's own rows, not into the org's.
    const { org, building } = await duplex();
    const other = await createBuilding(org.id);
    const otherUnit = await createUnit(org.id, other.id, { label: "A" });
    const otherCode = await createAccessCode(org.id, other.id);

    const editor = await editorFor(building.id);

    for (const submission of [
      {
        ...editor,
        trashDay: "thu" as const,
        accessCodes: [
          { ...emptyAccessCodeFields(), code: "9999", unitId: otherUnit.id },
        ],
      },
      {
        ...editor,
        trashDay: "thu" as const,
        accessCodes: [{ ...emptyAccessCodeFields(), id: otherCode.id }],
      },
    ]) {
      expect(await saveBuildingFacts(building.id, submission)).toEqual({
        ok: false,
        errors: { form: UNREADABLE_FORM },
      });
    }

    expect(await testDb().select().from(buildingFacts)).toEqual([]);
    expect(await testDb().select().from(buildingAccessCodes)).toHaveLength(1);
    expect(await codeRow(otherCode.id)).toEqual(otherCode);
    expect(records()).toEqual([]);
  });
});

describe("revealAccessCode", () => {
  it("opens one code, and records who revealed which — never the code", async () => {
    const { org, owner, building } = await duplex();
    const code = await createAccessCode(org.id, building.id, {
      label: "Rear door",
      code: "4417#",
    });

    expect(await revealAccessCode(code.id)).toEqual({
      ok: true,
      code: "4417#",
    });

    expect(records()).toMatchObject([
      {
        event: "revealed",
        org_id: org.id,
        user_id: owner.id,
        access_code_id: code.id,
        building_id: building.id,
      },
    ]);
    expect(logged.join("\n")).not.toContain("4417#");
    expect(logged.join("\n")).not.toContain("Rear door");
  });

  it("will not open a code sealed for another org, and records that it tried", async () => {
    // A row whose secret was sealed for somebody else — what a secret copied
    // between orgs looks like, and what a preview reading production's rows
    // under its own key looks like too (ADR-0008).
    const { org, building } = await duplex();
    const elsewhere = await createOrganization();
    const code = await createAccessCode(org.id, building.id);
    const foreign = await createAccessCode(
      elsewhere.id,
      (await createBuilding(elsewhere.id)).id,
    );

    await testDb()
      .update(buildingAccessCodes)
      .set({ secret: foreign.secret })
      .where(eq(buildingAccessCodes.id, code.id));

    expect(await revealAccessCode(code.id)).toEqual({ ok: false });
    expect(records()).toMatchObject([
      { event: "reveal_failed", access_code_id: code.id },
    ]);
  });

  it("says nothing about an id that is not a code", async () => {
    await duplex();

    for (const id of ["not-an-id", "0192f0c4-5b1e-7c3a-9d2e-4f6a8b0c1d2e"]) {
      expect(await revealAccessCode(id)).toEqual({ ok: false });
    }
    expect(records()).toEqual([]);
  });
});

describe("removing a unit from the building form", () => {
  it("is held back by a utility account on the unit, and says which", async () => {
    const { org, building, a, b } = await duplex();
    await createUtility(org.id, building.id, { unitId: b.id });

    const result = await updateBuilding(
      building.id,
      buildingFields(building, [a]),
    );

    expect(result).toEqual({
      ok: false,
      errors: {
        units:
          "Unit “B” has a utility account in Building facts. Change the account to Shared, or remove it there, before removing the unit.",
      },
    });
    expect(await testDb().select().from(units)).toHaveLength(2);
  });

  it("takes the unit's codes with it, and records each as removed", async () => {
    const { org, building, a, b } = await duplex();
    const code = await createAccessCode(org.id, building.id, { unitId: b.id });
    await createAccessCode(org.id, building.id, { unitId: a.id });

    const result = await updateBuilding(
      building.id,
      buildingFields(building, [a]),
    );

    expect(result).toEqual({ ok: true, buildingId: building.id });
    expect(await codeRow(code.id)).toBeUndefined();
    expect(await testDb().select().from(buildingAccessCodes)).toHaveLength(1);
    expect(records().map((line) => [line.event, line.access_code_id])).toEqual([
      ["removed", code.id],
    ]);
  });
});
