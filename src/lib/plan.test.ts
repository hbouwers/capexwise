/**
 * Two pricing decisions, held in place. Neither is a restatement of the table in
 * `plan.ts` — each is a rule that table is not allowed to break, and a failure
 * here means somebody changed what a customer pays for without deciding to.
 */
import { describe, expect, it } from "vitest";

import { can, type Feature, type Plan } from "@/lib/plan";

// Written as records so that the compiler, not a reader, notices when a plan or
// a feature is added and these lists are not: `satisfies` fails typecheck on a
// missing key, where a bare array would quietly test the old set.
const PLANS = Object.keys({
  free: true,
  paid: true,
  premium: true,
} satisfies Record<Plan, true>) as Plan[];

const FEATURES = Object.keys({
  quoteRequests: true,
  advisor: true,
} satisfies Record<Feature, true>) as Feature[];

describe("can", () => {
  it("never separates free from paid by feature", () => {
    // PRD §12, question 3: the free tier gates by capacity, so a free org with
    // its one unit sees everything a paying org sees. A feature that is paid
    // but not free is the forecast-behind-a-paywall the PRD rejected.
    for (const feature of FEATURES) {
      expect(can({ plan: "free" }, feature), feature).toBe(
        can({ plan: "paid" }, feature),
      );
    }
  });

  it("keeps F7 and F8 to premium", () => {
    // `paid` is $5 a unit, and premium is paid *plus* these two. The first is a
    // per-message cost of ours (PRD F7), so granting it to `paid` is a margin
    // leak rather than a generosity.
    for (const feature of FEATURES) {
      const granted = PLANS.filter((plan) => can({ plan }, feature));

      expect(granted, feature).toEqual(["premium"]);
    }
  });
});
