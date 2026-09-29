/**
 * The parts of an org's tax year that live in SQL: the defaults a year starts
 * with, one row per year, and the range a rate can take. `docs/data-model.md`
 * §6 makes each claim in prose, and the tax planner (#144) reads a missing row
 * as the defaults, so the defaults here have to be the same ones.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_DE_MINIMIS_CENTS } from "@/lib/tax/statement";
import { createOrganization, createTaxYear } from "@/test/factories";
import {
  CHECK_VIOLATION,
  rejectsWith,
  UNIQUE_VIOLATION,
} from "@/test/postgres-errors";

describe("tax_years", () => {
  it("starts a year with the safe harbor elected at $2,500, and no rate", async () => {
    const org = await createOrganization();

    expect(await createTaxYear(org.id)).toMatchObject({
      year: 2026,
      blendedRateBps: null,
      deMinimisElected: true,
      deMinimisThresholdCents: DEFAULT_DE_MINIMIS_CENTS,
    });
  });

  it("holds one row per year for an org, and the same year for another", async () => {
    const org = await createOrganization();
    const other = await createOrganization();
    await createTaxYear(org.id);
    await createTaxYear(org.id, { year: 2027 });
    await createTaxYear(other.id);

    await expect(createTaxYear(org.id)).rejects.toSatisfy(
      rejectsWith(UNIQUE_VIOLATION),
    );
  });

  it("refuses a rate outside 0% to 100%", async () => {
    const org = await createOrganization();

    for (const blendedRateBps of [-1, 10_001]) {
      await expect(createTaxYear(org.id, { blendedRateBps })).rejects.toSatisfy(
        rejectsWith(CHECK_VIOLATION),
      );
    }
    expect(await createTaxYear(org.id, { blendedRateBps: 0 })).toMatchObject({
      blendedRateBps: 0,
    });
  });
});
