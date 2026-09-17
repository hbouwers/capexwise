/**
 * A capital item's forms, once, for both sides of each
 * (`docs/ui/screens/building-detail.md`, Equipment & capital items): the two
 * that say when an item went in and what it cost — `Confirm`, which turns an
 * estimated item into an audited one, and the item editor's
 * `Record replacement` — and the editor's own form, which edits the item in
 * service. The browser runs the validator before it sends anything and the
 * server action runs it again — `building-form.ts` explains why one function
 * serves both.
 *
 * A replacement is a new row and the old one is marked replaced; nothing here
 * turns one item's row into another's (data-model §5). The editor does change
 * an install year — a guess corrected, or a label read — and that is an edit
 * to the same machine, not a new one.
 */
import { z } from "zod";

import { moneyField } from "@/lib/building-form";
import {
  type CalendarDate,
  formatDate,
  isCalendarDate,
  yearOf,
} from "@/lib/dates";
import { amount, type FieldErrors, UNREADABLE_FORM } from "@/lib/forms";
import type { Cents } from "@/lib/money";

/** Either form, as typed. */
export type InstallFields = { installedOn: string; cost: string };

/** The install, under the columns' Drizzle names. */
export type InstallValues = {
  installDate: CalendarDate;
  installYear: number;
  actualCostCents: Cents | null;
};

export type ValidatedInstall =
  { ok: true; values: InstallValues } | { ok: false; errors: FieldErrors };

const shape = z.object({
  installedOn: z.string().max(500),
  cost: z.string().max(500),
});

/** The earliest install year `capital_items_install_year_plausible` allows. */
const EARLIEST_YEAR = 1600;

/**
 * What is wrong with an install date as typed, or null for one that passes:
 * the message for a missing one, then the whole-date, has-happened and
 * plausible-year rules, then a further rule for a date that got that far.
 * `null` from `laterThan` is a date that passes it.
 */
function dateError(
  raw: string,
  today: CalendarDate,
  missing: string,
  laterThan: (date: CalendarDate) => string | null,
): string | null {
  if (raw === "") return missing;
  if (!isCalendarDate(raw))
    return "Enter the whole date — day, month and year.";
  if (raw > today) return "Enter today’s date or an earlier one.";
  if (yearOf(raw) < EARLIEST_YEAR) {
    return `Enter a date in ${EARLIEST_YEAR} or later.`;
  }
  return laterThan(raw);
}

/** The rules both install forms share. */
function validateInstall(
  input: unknown,
  today: CalendarDate,
  missing: string,
  laterThan: (date: CalendarDate) => string | null,
): ValidatedInstall {
  const parsed = shape.safeParse(input);
  if (!parsed.success) return { ok: false, errors: { form: UNREADABLE_FORM } };

  const fields = parsed.data;
  const errors: FieldErrors = {};

  const date = fields.installedOn.trim();
  const dateMessage = dateError(date, today, missing, laterThan);
  if (dateMessage !== null) errors.installedOn = dateMessage;

  const cost = amount(fields.cost);
  if (cost.state === "bad") errors.cost = cost.message;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    values: {
      installDate: date,
      installYear: yearOf(date),
      actualCostCents: cost.state === "ok" ? cost.cents : null,
    },
  };
}

/**
 * `Confirm`: the day the item actually went in, and what it cost — PRD F2's
 * prompt, and what the schema asks of an audited item.
 *
 * - **The date is required**, and replaces the estimated year: the estimate
 *   was a guess at this date, so an estimate of 2014 confirmed as March 2011
 *   is an item installed in 2011 (ADR-0005).
 * - **It has happened** — today where the building is, as the replacement's.
 * - **The cost is optional**, and it is what the item did cost — the tax
 *   basis, `actual_cost_cents` — not what replacing it will. Somebody reading
 *   a label rarely has the invoice.
 */
export function validateConfirmation(
  input: unknown,
  today: CalendarDate,
): ValidatedInstall {
  return validateInstall(
    input,
    today,
    "Enter the day it was installed.",
    () => null,
  );
}

/**
 * `Record replacement`: every rule `Confirm` has, and one more.
 *
 * - **The date is required.** A replacement is recorded as audited, and an
 *   audited item says when it went in, to the day (ADR-0005).
 * - **It has happened.** `today` is today where the building is, so a date
 *   after it is a typo in the year, most likely — and a replacement not yet
 *   done is a plan, which is #96's to store.
 * - **It is not older than what it replaced** — the old item's install date
 *   when it was audited, its year when it was only estimated. A furnace put in
 *   before the one it replaced is two rows in the wrong order.
 * - **The cost is optional**, as `Confirm`'s is: a replacement under warranty
 *   may have cost nothing, and one whose invoice is lost is still a fact.
 */
export function validateReplacement(
  input: unknown,
  today: CalendarDate,
  replaced: { installYear: number; installDate: CalendarDate | null },
): ValidatedInstall {
  return validateInstall(
    input,
    today,
    "Enter the day the new one was installed.",
    (date) => {
      if (replaced.installDate !== null && date < replaced.installDate) {
        return `Enter ${formatDate(replaced.installDate)} or later — the one it replaces went in then.`;
      }
      if (yearOf(date) < replaced.installYear) {
        return `Enter a date in ${replaced.installYear} or later — the one it replaces went in then.`;
      }
      return null;
    },
  );
}

/**
 * The item editor's form, as typed and chosen. An estimated item has a year
 * and an audited one a date; both fields are kept while the confidence is
 * switched back and forth, and only the chosen one is read.
 */
export type ItemFields = {
  label: string;
  /** `estimated` or `audited`. */
  confidence: string;
  /** Read when estimated: the year, as four digits. */
  installYear: string;
  /** Read when audited: the day it went in. */
  installedOn: string;
  /** What installing it did cost — the basis. Optional. */
  cost: string;
  expectedLife: string;
  replacementCost: string;
  /** `shared`, or one of the building's units. */
  scope: string;
  notes: string;
};

export type ItemConfidence = "estimated" | "audited";

/** The form, under the columns' Drizzle names. */
export type ItemValues = {
  label: string;
  confidence: ItemConfidence;
  installYear: number;
  /** Null for an estimated item. */
  installDate: CalendarDate | null;
  actualCostCents: Cents | null;
  expectedLifeYears: number;
  replacementCostCents: Cents;
  /** Null for the building's own. Still to be found in the building. */
  unitId: string | null;
  notes: string | null;
};

export type ValidatedItem =
  { ok: true; values: ItemValues } | { ok: false; errors: FieldErrors };

/** Long enough for `Furnace, basement (Carrier 58STA)`; the rest is notes. */
export const LABEL_MAX = 200;

/** A paragraph or two about the machine, not its manual. */
export const NOTES_MAX = 5000;

/**
 * Longer than anything in the catalogue lasts, with room for slate and
 * copper. Above it the number is a typo — a cost in the wrong field, most
 * likely.
 */
export const LIFE_MAX = 200;

const itemShape = z.object({
  label: z.string().max(5000),
  confidence: z.string().max(20),
  installYear: z.string().max(100),
  installedOn: z.string().max(500),
  cost: z.string().max(500),
  expectedLife: z.string().max(100),
  replacementCost: z.string().max(500),
  scope: z.string().max(100),
  notes: z.string().max(50_000),
});

const uuid = z.uuid();

/**
 * The editor's rules.
 *
 * - **The label is required**, trimmed, and held to `LABEL_MAX`.
 * - **An estimated item has a year**: four digits, `EARLIEST_YEAR` or later,
 *   and not after this year where the building is. A year is a guess at when
 *   it went in, and a guess about the future is a plan (#96).
 * - **An audited item has a date**, under `Confirm`'s rules: whole, has
 *   happened, plausible. Its year is the date's — the two never disagree
 *   (`capital_items_install_date_in_year`).
 * - **What it cost is optional**, and is the basis, as `Confirm`'s is.
 * - **The life is a whole number of years**, at least one and at most
 *   `LIFE_MAX`. The forecast divides by it.
 * - **The replacement cost is required** — the forecast's figure, and the
 *   column is `not null`. Zero is allowed: a thing that will not be replaced
 *   when it goes is still tracked for its life.
 * - **The scope is `shared` or a unit's id.** Which units the building has is
 *   the action's to know.
 * - **Notes are optional**, trimmed, and held to `NOTES_MAX`.
 *
 * A confidence or a scope the form could not have sent is the whole form's
 * problem, as an unreadable submission is.
 */
export function validateCapitalItem(
  input: unknown,
  today: CalendarDate,
): ValidatedItem {
  const parsed = itemShape.safeParse(input);
  if (!parsed.success) return { ok: false, errors: { form: UNREADABLE_FORM } };

  const fields = parsed.data;
  const errors: FieldErrors = {};

  if (fields.confidence !== "estimated" && fields.confidence !== "audited") {
    return { ok: false, errors: { form: UNREADABLE_FORM } };
  }
  const confidence: ItemConfidence = fields.confidence;

  const shared = fields.scope === "shared";
  if (!shared && !uuid.safeParse(fields.scope).success) {
    return { ok: false, errors: { form: UNREADABLE_FORM } };
  }

  const label = fields.label.trim();
  if (label === "") {
    errors.label = "Enter what the item is called.";
  } else if (label.length > LABEL_MAX) {
    errors.label = `Keep it to ${LABEL_MAX} characters — put the rest in the notes.`;
  }

  let installYear = 0;
  let installDate: CalendarDate | null = null;

  if (confidence === "estimated") {
    const year = fields.installYear.trim();
    if (year === "") {
      errors.installYear = "Enter the year it was installed, like 2014.";
    } else if (!/^\d{4}$/.test(year)) {
      errors.installYear = "Enter the year as four digits, like 2014.";
    } else if (Number(year) < EARLIEST_YEAR) {
      errors.installYear = `Enter a year in ${EARLIEST_YEAR} or later.`;
    } else if (Number(year) > yearOf(today)) {
      errors.installYear = "Enter this year or an earlier one.";
    } else {
      installYear = Number(year);
    }
  } else {
    const date = fields.installedOn.trim();
    const dateMessage = dateError(
      date,
      today,
      "Enter the day it was installed.",
      () => null,
    );
    if (dateMessage !== null) {
      errors.installedOn = dateMessage;
    } else {
      installDate = date;
      installYear = yearOf(date);
    }
  }

  const cost = amount(fields.cost);
  if (cost.state === "bad") errors.cost = cost.message;

  const life = fields.expectedLife.trim();
  let expectedLifeYears = 0;
  if (life === "") {
    errors.expectedLife = "Enter how many years it typically lasts.";
  } else if (!/^\d+$/.test(life) || Number(life) < 1) {
    errors.expectedLife = "Enter a whole number of years, like 15.";
  } else if (Number(life) > LIFE_MAX) {
    errors.expectedLife = `Enter ${LIFE_MAX} years or fewer.`;
  } else {
    expectedLifeYears = Number(life);
  }

  const replacement = amount(fields.replacementCost);
  let replacementCostCents: Cents = 0;
  if (replacement.state === "empty") {
    errors.replacementCost = "Enter what replacing it would cost.";
  } else if (replacement.state === "bad") {
    errors.replacementCost = replacement.message;
  } else {
    replacementCostCents = replacement.cents;
  }

  const notes = fields.notes.trim();
  if (notes.length > NOTES_MAX) {
    errors.notes = `Keep the notes to ${NOTES_MAX.toLocaleString("en-US")} characters.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    values: {
      label,
      confidence,
      installYear,
      installDate,
      actualCostCents: cost.state === "ok" ? cost.cents : null,
      expectedLifeYears,
      replacementCostCents,
      unitId: shared ? null : fields.scope,
      notes: notes === "" ? null : notes,
    },
  };
}

/** The editor's form as the item's row fills it. */
export function itemFields(item: {
  label: string;
  confidence: ItemConfidence;
  installYear: number;
  installDate: CalendarDate | null;
  actualCostCents: Cents | null;
  expectedLifeYears: number;
  replacementCostCents: Cents;
  unitId: string | null;
  notes: string | null;
}): ItemFields {
  return {
    label: item.label,
    confidence: item.confidence,
    installYear: String(item.installYear),
    installedOn: item.installDate ?? "",
    cost: moneyField(item.actualCostCents),
    expectedLife: String(item.expectedLifeYears),
    replacementCost: moneyField(item.replacementCostCents),
    scope: item.unitId ?? "shared",
    notes: item.notes ?? "",
  };
}
