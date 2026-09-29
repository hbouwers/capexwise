/**
 * The estimated Schedule E for one tax year (`docs/ui/screens/tax-planner.md`,
 * Income statement): gross rent, the recorded expenses, the depreciation of
 * each building and of the improvements made to it, and what planned work
 * this year would deduct. For one building or the whole portfolio — the
 * statement covers whichever buildings it is given.
 *
 * **Every line keeps its inputs**, because that is how PRD F4's traceability
 * is met: the page opens a line to the rows this returns for it, and renders
 * nothing it did not compute here.
 *
 * **What is not decided is named, never guessed.** A building with no basis
 * is excluded and counted as excluded, not depreciated from zero. Work nobody
 * has called a repair or an improvement is left out of every line and listed,
 * so the statement is what has been decided and says what has not. Where the
 * month work goes into service is unknown, July is taken and the line says so.
 *
 * Integer cents, and an expense's amount as the ledger stores it: money out
 * is negative (`docs/data-model.md` §6). Every line here is a deduction or an
 * income, and so the right way up.
 */
import { type CalendarDate, monthOf, yearOf } from "@/lib/dates";
import { type Classification } from "@/lib/expenses";
import { type Cents } from "@/lib/money";

import {
  ASSUMED_MONTH,
  depreciationIn,
  halfMonthsInServiceIn,
  type PlacedInService,
  type RecoveryClass,
} from "@/lib/tax/depreciation";

/**
 * The de minimis safe harbor's threshold where a year has no setting of its
 * own: $2,500 an item or invoice, the figure for a taxpayer without an
 * audited financial statement (#144, decision 2).
 */
export const DEFAULT_DE_MINIMIS_CENTS: Cents = 250_000;

/** The Schedule E category with a statement line of its own. */
export const MORTGAGE_INTEREST = "mortgage-interest";

export type TaxBuilding = {
  id: string;
  label: string;
  /** When depreciation starts. Not always the day it was bought. */
  inServiceOn: CalendarDate | null;
  /** The building's share of the basis, land excluded. */
  buildingBasisCents: Cents | null;
  /**
   * The year's rent: marked received so far, and expected for the months
   * still to come. Rent arithmetic is the rent roll's, so it arrives summed.
   */
  rent: { receivedCents: Cents; expectedCents: Cents };
};

/** A row of the ledger, from any year: earlier improvements still recover. */
export type TaxExpense = {
  id: string;
  buildingId: string;
  capitalItemId: string | null;
  label: string;
  occurredOn: CalendarDate;
  /** As stored: money out is negative, a refund positive. */
  amountCents: Cents;
  category: string;
  /** Null where the expense was never asked (`asksClassification`). */
  classification: Classification | null;
  /** The schedule it recovers over, if it is an improvement. */
  recovery: RecoveryClass;
};

/**
 * A capital item as installed: decision 3's second source of improvements,
 * for equipment whose cost is known but was never put on the ledger.
 */
export type TaxItem = {
  id: string;
  buildingId: string;
  label: string;
  installYear: number;
  /** Only when audited. */
  installDate: CalendarDate | null;
  actualCostCents: Cents | null;
  recovery: RecoveryClass;
};

/** A live plan (#96), for this year or another. */
export type TaxPlan = {
  id: string;
  buildingId: string;
  label: string;
  costCents: Cents;
  plannedYear: number;
  /** Null when only the year is chosen; July is taken, and said. */
  plannedMonth: number | null;
  classification: Classification;
  recovery: RecoveryClass;
};

export type StatementInput = {
  year: number;
  buildings: readonly TaxBuilding[];
  /** Every year's, up to this one. The statement picks what it needs. */
  expenses: readonly TaxExpense[];
  /** Every item, whatever its status: a replaced one still recovers. */
  items: readonly TaxItem[];
  /** Live plans only: a plan carried out is on the ledger. */
  plans: readonly TaxPlan[];
  /**
   * The threshold set for each year, or null for a year it was not elected.
   * A year with no entry takes `DEFAULT_DE_MINIMIS_CENTS`.
   */
  deMinimis: ReadonlyMap<number, Cents | null>;
};

/** Where a row came from: the ledger, an item's install, or a plan. */
export type Source = "ledger" | "item" | "plan";

/** Something deducted in full this year. */
export type Deduction = {
  source: Source;
  id: string;
  buildingId: string;
  label: string;
  costCents: Cents;
  /**
   * `repair`: planned work called a repair. `de-minimis`: an improvement at
   * or under the year's threshold, which the safe harbor deducts in the year
   * it is placed in service rather than capitalizing.
   */
  reason: "repair" | "de-minimis";
};

/** This year's share of one capitalized improvement. */
export type ImprovementDepreciation = {
  source: Source;
  id: string;
  buildingId: string;
  label: string;
  basisCents: Cents;
  recovery: RecoveryClass;
  placedInService: PlacedInService;
  /** Half-months of this year it was depreciated for. */
  halfMonths: number;
  amountCents: Cents;
};

export type BuildingDepreciation =
  | {
      buildingId: string;
      kind: "depreciated";
      basisCents: Cents;
      inServiceOn: CalendarDate;
      halfMonths: number;
      amountCents: Cents;
    }
  | {
      buildingId: string;
      kind: "excluded";
      /** What is missing, which the row names and links to. */
      missing: "basis" | "in-service-date";
    };

export type CategoryTotal = {
  category: string;
  totalCents: Cents;
  expenseIds: string[];
};

export type Statement = {
  year: number;
  grossRent: {
    totalCents: Cents;
    receivedCents: Cents;
    expectedCents: Cents;
    byBuilding: {
      buildingId: string;
      receivedCents: Cents;
      expectedCents: Cents;
    }[];
  };
  /** Recorded this year, by category, mortgage interest apart. */
  operatingExpenses: { totalCents: Cents; byCategory: CategoryTotal[] };
  mortgageInterest: { totalCents: Cents; expenseIds: string[] };
  buildingDepreciation: {
    totalCents: Cents;
    rows: BuildingDepreciation[];
    /** `Excludes depreciation for {n} building(s).` */
    excludedCount: number;
  };
  /** `Repairs deducted this year`: planned repairs, and the de minimis. */
  deductedInFull: { totalCents: Cents; rows: Deduction[] };
  improvementDepreciation: {
    totalCents: Cents;
    rows: ImprovementDepreciation[];
  };
  taxableCents: Cents;
  /** What was capitalized this year: the liability card's new basis. */
  newBasisCents: Cents;
  /** Left out of every line, and listed so the page can say so. */
  notCounted: {
    /** Planned this year, with no call made. */
    unclassifiedPlans: TaxPlan[];
    /** Recorded this year as `unclassified`. */
    unclassifiedExpenses: TaxExpense[];
    /**
     * Installed with a known cost on a building with no in-service date, so
     * whether it is part of the building's basis cannot be told.
     */
    undatedItems: TaxItem[];
  };
};

/** The threshold for `year`: its own setting, or the default. */
export function deMinimisFor(
  deMinimis: ReadonlyMap<number, Cents | null>,
  year: number,
): Cents | null {
  const set = deMinimis.get(year);
  return set === undefined ? DEFAULT_DE_MINIMIS_CENTS : set;
}

/**
 * Whether the safe harbor deducts `costCents` in full: at or under the
 * threshold, in a year it was elected. On the magnitude, so a refund is
 * treated as the mirror of a purchase of its size.
 */
export function underDeMinimis(
  costCents: Cents,
  thresholdCents: Cents | null,
): boolean {
  return thresholdCents !== null && Math.abs(costCents) <= thresholdCents;
}

export function statement(input: StatementInput): Statement {
  const { year } = input;
  const buildings = new Map(input.buildings.map((b) => [b.id, b]));
  const buildingOf = (row: { id: string; buildingId: string }) => {
    const building = buildings.get(row.buildingId);
    if (!building) {
      throw new RangeError(
        `${row.id} is on building ${row.buildingId}, which the statement was not given.`,
      );
    }
    return building;
  };

  const result: Statement = {
    year,
    grossRent: {
      totalCents: 0,
      receivedCents: 0,
      expectedCents: 0,
      byBuilding: [],
    },
    operatingExpenses: { totalCents: 0, byCategory: [] },
    mortgageInterest: { totalCents: 0, expenseIds: [] },
    buildingDepreciation: { totalCents: 0, rows: [], excludedCount: 0 },
    deductedInFull: { totalCents: 0, rows: [] },
    improvementDepreciation: { totalCents: 0, rows: [] },
    taxableCents: 0,
    newBasisCents: 0,
    notCounted: {
      unclassifiedPlans: [],
      unclassifiedExpenses: [],
      undatedItems: [],
    },
  };

  const deduct = (row: Deduction) => {
    result.deductedInFull.rows.push(row);
    result.deductedInFull.totalCents += row.costCents;
  };

  /**
   * An improvement, deducted under the safe harbor in the year it goes into
   * service, or capitalized and recovered: in which case this year's share,
   * and its whole cost as new basis if this is the year it started.
   */
  const improve = (
    row: Omit<Deduction, "reason" | "costCents">,
    basisCents: Cents,
    recovery: RecoveryClass,
    placed: PlacedInService,
  ) => {
    if (placed.year > year) return;

    if (
      underDeMinimis(basisCents, deMinimisFor(input.deMinimis, placed.year))
    ) {
      if (placed.year === year) {
        deduct({ ...row, costCents: basisCents, reason: "de-minimis" });
      }
      return;
    }

    const amountCents = depreciationIn(basisCents, recovery, placed, year);
    if (placed.year === year) result.newBasisCents += basisCents;
    // Fully recovered: nothing this year, and nothing to open.
    if (amountCents === 0 && placed.year < year) return;

    result.improvementDepreciation.rows.push({
      ...row,
      basisCents,
      recovery,
      placedInService: placed,
      halfMonths: halfMonthsInServiceIn(recovery, placed, year),
      amountCents,
    });
    result.improvementDepreciation.totalCents += amountCents;
  };

  // Gross rent, and each building's own depreciation.
  for (const building of input.buildings) {
    assertCents(building.rent.receivedCents, building.id);
    assertCents(building.rent.expectedCents, building.id);

    result.grossRent.byBuilding.push({
      buildingId: building.id,
      receivedCents: building.rent.receivedCents,
      expectedCents: building.rent.expectedCents,
    });
    result.grossRent.receivedCents += building.rent.receivedCents;
    result.grossRent.expectedCents += building.rent.expectedCents;

    const basis = building.buildingBasisCents;
    const inService = building.inServiceOn;
    if (basis === null || inService === null) {
      result.buildingDepreciation.rows.push({
        buildingId: building.id,
        kind: "excluded",
        missing: basis === null ? "basis" : "in-service-date",
      });
      result.buildingDepreciation.excludedCount += 1;
      continue;
    }

    const placed = { year: yearOf(inService), month: monthOf(inService) };
    const amountCents = depreciationIn(basis, "residential", placed, year);
    result.buildingDepreciation.rows.push({
      buildingId: building.id,
      kind: "depreciated",
      basisCents: basis,
      inServiceOn: inService,
      halfMonths: halfMonthsInServiceIn("residential", placed, year),
      amountCents,
    });
    result.buildingDepreciation.totalCents += amountCents;
  }
  result.grossRent.totalCents =
    result.grossRent.receivedCents + result.grossRent.expectedCents;

  // The ledger. An improvement recovers in every year after it, so every
  // year's is read; everything else counts only in the year it was spent.
  const categories = new Map<string, CategoryTotal>();
  /** Item id → the years spend was recorded against it. */
  const spentOn = new Map<string, Set<number>>();

  for (const expense of input.expenses) {
    const building = buildingOf(expense);
    assertCents(expense.amountCents, expense.id);

    const spentIn = yearOf(expense.occurredOn);
    if (expense.capitalItemId !== null) {
      const years = spentOn.get(expense.capitalItemId) ?? new Set();
      years.add(spentIn);
      spentOn.set(expense.capitalItemId, years);
    }
    if (spentIn > year) continue;

    if (expense.classification === "improvement") {
      // Work done before the building was placed in service goes into
      // service with it.
      const from =
        building.inServiceOn !== null &&
        building.inServiceOn > expense.occurredOn
          ? building.inServiceOn
          : expense.occurredOn;
      improve(
        {
          source: "ledger",
          id: expense.id,
          buildingId: expense.buildingId,
          label: expense.label,
        },
        -expense.amountCents,
        expense.recovery,
        { year: yearOf(from), month: monthOf(from), assumed: false },
      );
      continue;
    }

    if (spentIn !== year) continue;

    if (expense.classification === "unclassified") {
      result.notCounted.unclassifiedExpenses.push(expense);
      continue;
    }

    const deductible = -expense.amountCents;
    if (expense.category === MORTGAGE_INTEREST) {
      result.mortgageInterest.totalCents += deductible;
      result.mortgageInterest.expenseIds.push(expense.id);
      continue;
    }

    const category = categories.get(expense.category) ?? {
      category: expense.category,
      totalCents: 0,
      expenseIds: [],
    };
    category.totalCents += deductible;
    category.expenseIds.push(expense.id);
    categories.set(expense.category, category);
    result.operatingExpenses.totalCents += deductible;
  }
  result.operatingExpenses.byCategory = [...categories.values()].sort(
    (a, b) => b.totalCents - a.totalCents || compare(a.category, b.category),
  );

  // Equipment whose install cost is known and never reached the ledger.
  for (const item of input.items) {
    const building = buildingOf(item);
    if (item.actualCostCents === null || item.actualCostCents === 0) continue;
    assertCents(item.actualCostCents, item.id);
    if (item.installYear > year) continue;

    // Spend recorded against it in the year it went in is taken to be the
    // install, whatever it was classified as: counting both would deduct the
    // one cost twice. Spend in a later year is a later job.
    if (spentOn.get(item.id)?.has(item.installYear)) continue;

    const inService = building.inServiceOn;
    if (inService === null) {
      result.notCounted.undatedItems.push(item);
      continue;
    }

    // Installed before the building went into service, it is part of the
    // building's basis already. In the same year with no date to tell, it is
    // taken to be, so it is never counted twice.
    const partOfBasis =
      item.installDate !== null
        ? item.installDate <= inService
        : item.installYear <= yearOf(inService);
    if (partOfBasis) continue;

    improve(
      {
        source: "item",
        id: item.id,
        buildingId: item.buildingId,
        label: item.label,
      },
      item.actualCostCents,
      item.recovery,
      item.installDate !== null
        ? {
            year: yearOf(item.installDate),
            month: monthOf(item.installDate),
            assumed: false,
          }
        : { year: item.installYear, month: ASSUMED_MONTH, assumed: true },
    );
  }

  // This year's plans.
  for (const plan of input.plans) {
    buildingOf(plan);
    assertCents(plan.costCents, plan.id);
    if (plan.costCents < 0) {
      throw new RangeError(`A plan costs nothing below zero, got ${plan.id}.`);
    }
    if (plan.plannedYear !== year) continue;

    if (plan.classification === "unclassified") {
      result.notCounted.unclassifiedPlans.push(plan);
      continue;
    }

    const row = {
      source: "plan" as const,
      id: plan.id,
      buildingId: plan.buildingId,
      label: plan.label,
    };
    if (plan.classification === "repair") {
      deduct({ ...row, costCents: plan.costCents, reason: "repair" });
      continue;
    }

    improve(row, plan.costCents, plan.recovery, {
      year,
      month: plan.plannedMonth ?? ASSUMED_MONTH,
      assumed: plan.plannedMonth === null,
    });
  }

  result.taxableCents =
    result.grossRent.totalCents -
    result.operatingExpenses.totalCents -
    result.mortgageInterest.totalCents -
    result.buildingDepreciation.totalCents -
    result.deductedInFull.totalCents -
    result.improvementDepreciation.totalCents;

  return result;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function assertCents(cents: number, id: string): void {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(
      `Expected whole cents, got ${cents} for ${id}. Money is integer cents (ADR-0005).`,
    );
  }
}
