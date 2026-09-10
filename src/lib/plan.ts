/**
 * What an org's plan lets it use — PRD F9's `can(org, feature)`, shipped in v0
 * so the seam exists before billing does.
 *
 * **This gates features, and only the premium ones.** Pricing settled that free
 * and paid differ by *capacity* — one unit against unbounded — and never by
 * feature (PRD §12, question 3): hiding the forecast behind the paywall would
 * hide the thing that justifies paying. So the only features that belong in the
 * table below are the ones `premium` adds on top of `paid`, which today are F7
 * and F8. `plan.test.ts` holds that line, and a feature that wants to be
 * paid-only is a pricing decision to reopen, not a row to add.
 *
 * **Capacity is a different check, and it is not here.** "May this org add a
 * second unit" is a count, not a lookup: the free unit is per *account* rather
 * than per org (`docs/data-model.md` §2), so it asks across every org the owner
 * holds — which is a query, and `src/lib/` holds no queries. It arrives with the
 * units table and the billing work.
 *
 * Framework-free on purpose, so that it runs identically wherever the answer is
 * needed. What keeps it honest is where the `org` comes from, not where this
 * runs: `getOrgContext()` resolves it on the server, and `PlanGate` takes the
 * result as a prop rather than asking the browser (`docs/ui/components.md` §8).
 */
import type { organizations } from "@/db/schema";

export type Plan = (typeof organizations.$inferSelect)["plan"];

/**
 * Keyed by feature rather than by plan, so a new feature cannot be added
 * without naming who gets it. A plan added to `org_plan` and not named here gets
 * nothing, which is the right way for a new tier to fail.
 */
const PLANS_WITH = {
  /** F7 — quote requests to three or more matching contacts. */
  quoteRequests: ["premium"],
  /** F8 — the advisor's pull-forward and push-out recommendations. */
  advisor: ["premium"],
} as const satisfies Record<string, readonly Plan[]>;

export type Feature = keyof typeof PLANS_WITH;

export function can(org: { plan: Plan }, feature: Feature): boolean {
  const plans: readonly Plan[] = PLANS_WITH[feature];

  return plans.includes(org.plan);
}
