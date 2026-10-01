/**
 * The tax planner's arithmetic in one call (`docs/ui/screens/tax-planner.md`):
 * the statement, the estimated liability card, and the timing levers. A
 * changed classification is the same call with the plan changed, so the
 * statement, the liability and the levers always move together, and every
 * figure on the page is one this module produced.
 *
 * **The rate has no default** (#144, decision 2). Until one is entered for the
 * year the liability is null and the card asks for it, because a figure
 * multiplied by a rate nobody chose is not traceable.
 *
 * **A rental loss is a liability of zero, not a saving.** Whether a loss comes
 * off other income depends on the passive activity rules, which PRD F4 defers
 * to v1.1, and on income this product never sees. So the estimate takes the
 * reading that never overstates what a plan saves, as the reserve does
 * (`CLAUDE.md`, Reserve timing), and the card says the year is a loss.
 */
import { type Cents } from "@/lib/money";

import { ASSUMED_MONTH, divideRounded } from "@/lib/tax/depreciation";
import {
  deMinimisFor,
  type Statement,
  statement,
  type StatementInput,
  type TaxPlan,
  underDeMinimis,
} from "@/lib/tax/statement";

export type TaxEstimateInput = StatementInput & {
  /** The blended rate for the year, in basis points: 29% is `2900`. */
  rateBps: number | null;
};

export type Liability = {
  rateBps: number;
  /** `Taxable rental income × {rate} blended rate`, and zero for a loss. */
  liabilityCents: Cents;
  /** Taxable rental income is below zero, so the liability is floored. */
  loss: boolean;
  /**
   * `Against doing nothing`: this liability less the one with every plan
   * this year left unclassified. Negative is a saving.
   */
  againstDoingNothingCents: Cents;
  /** Liability over gross rent, in basis points. Null with no rent. */
  effectiveRateBps: number | null;
};

/** A plan moved across the turn of the year, and what that does to this one. */
export type TimingLever = {
  plan: TaxPlan;
  from: { year: number; month: number; assumed: boolean };
  to: { year: number; month: number };
  /** The change in this year's taxable rental income. */
  taxableEffectCents: Cents;
  /** The change in this year's liability. Null until a rate is entered. */
  liabilityEffectCents: Cents | null;
};

/**
 * One of this year's plans, as the `Repair or improvement?` card shows it: what
 * its current call does to this year, against leaving it undecided.
 */
export type PlanDecision = {
  plan: TaxPlan;
  /**
   * The change in this year's taxable rental income from the call made. Zero
   * for an undecided plan, which counts for nothing either way.
   */
  taxableEffectCents: Cents;
  /** The change in this year's liability. Null until a rate is entered. */
  liabilityEffectCents: Cents | null;
  /**
   * At or under the year's de minimis threshold, so an improvement is
   * deducted in full this year as a repair is.
   */
  underDeMinimis: boolean;
};

export type TaxEstimate = {
  statement: Statement;
  liability: Liability | null;
  /** This year's plans, in the order they were given. */
  decisions: PlanDecision[];
  /** The year's de minimis threshold, or null where it is not elected. */
  deMinimisCents: Cents | null;
  levers: TimingLever[];
};

export function estimate(input: TaxEstimateInput): TaxEstimate {
  const { rateBps } = input;
  if (rateBps !== null) assertRate(rateBps);

  const current = statement(input);
  const liabilityOf = (s: Statement) =>
    rateBps === null ? null : liabilityFor(s.taxableCents, rateBps);

  let liability: Liability | null = null;
  if (rateBps !== null) {
    const liabilityCents = liabilityFor(current.taxableCents, rateBps);
    const doingNothing = statement({
      ...input,
      plans: input.plans.map((plan) =>
        plan.plannedYear === input.year
          ? { ...plan, classification: "unclassified" as const }
          : plan,
      ),
    });
    const gross = current.grossRent.totalCents;

    liability = {
      rateBps,
      liabilityCents,
      loss: current.taxableCents < 0,
      againstDoingNothingCents:
        liabilityCents - liabilityFor(doingNothing.taxableCents, rateBps),
      effectiveRateBps:
        gross > 0
          ? divideRounded(BigInt(liabilityCents) * 10_000n, BigInt(gross))
          : null,
    };
  }

  const deMinimisCents = deMinimisFor(input.deMinimis, input.year);

  // Each call against the same statement with only that plan undecided, so a
  // row's effect is its own and the rows need not sum to the card's total: a
  // loss floors the liability once, not per plan.
  const decisions: PlanDecision[] = input.plans
    .filter((plan) => plan.plannedYear === input.year)
    .map((plan) => {
      const without =
        plan.classification === "unclassified"
          ? current
          : statement({
              ...input,
              plans: input.plans.map((p) =>
                p.id === plan.id
                  ? { ...p, classification: "unclassified" as const }
                  : p,
              ),
            });
      const before = liabilityOf(without);
      const after = liabilityOf(current);

      return {
        plan,
        taxableEffectCents: current.taxableCents - without.taxableCents,
        liabilityEffectCents:
          before === null || after === null ? null : after - before,
        underDeMinimis: underDeMinimis(plan.costCents, deMinimisCents),
      };
    });

  const levers: TimingLever[] = [];
  for (const plan of input.plans) {
    if (plan.classification === "unclassified") continue;

    const to =
      plan.plannedYear === input.year
        ? { year: input.year + 1, month: 1 }
        : plan.plannedYear === input.year + 1
          ? { year: input.year, month: 12 }
          : null;
    if (to === null) continue;

    const moved = statement({
      ...input,
      plans: input.plans.map((p) =>
        p.id === plan.id
          ? { ...p, plannedYear: to.year, plannedMonth: to.month }
          : p,
      ),
    });
    const taxableEffectCents = moved.taxableCents - current.taxableCents;
    if (taxableEffectCents === 0) continue;

    const before = liabilityOf(current);
    const after = liabilityOf(moved);

    levers.push({
      plan,
      from: {
        year: plan.plannedYear,
        month: plan.plannedMonth ?? ASSUMED_MONTH,
        assumed: plan.plannedMonth === null,
      },
      to,
      taxableEffectCents,
      liabilityEffectCents:
        before === null || after === null ? null : after - before,
    });
  }

  // The biggest saving first. Without a rate, by the income it moves.
  levers.sort(
    (a, b) =>
      (a.liabilityEffectCents ?? 0) - (b.liabilityEffectCents ?? 0) ||
      a.taxableEffectCents - b.taxableEffectCents ||
      (a.plan.id < b.plan.id ? -1 : a.plan.id > b.plan.id ? 1 : 0),
  );

  return { statement: current, liability, decisions, deMinimisCents, levers };
}

/**
 * `taxable × rate`, rounded to the cent, and zero for a loss. The one place
 * the estimate rounds a product, so it rounds once.
 */
export function liabilityFor(taxableCents: Cents, rateBps: number): Cents {
  assertRate(rateBps);
  if (taxableCents <= 0) return 0;

  return divideRounded(BigInt(taxableCents) * BigInt(rateBps), 10_000n);
}

function assertRate(rateBps: number): void {
  if (!Number.isSafeInteger(rateBps) || rateBps < 0 || rateBps > 10_000) {
    throw new RangeError(
      `Expected a rate of 0 to 10,000 basis points, got ${rateBps}.`,
    );
  }
}
