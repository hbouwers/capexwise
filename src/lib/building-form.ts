/**
 * The building form's rules, once, for both sides of it
 * (`docs/ui/screens/building-form.md`). The browser runs `validateBuilding`
 * before it sends anything, so a person sees every problem at once without a
 * round trip; the server action runs it again on whatever arrives, because
 * what arrives is not evidence of what the browser checked. One function means
 * the two cannot disagree, and the spec's "its messages render the same way"
 * is true by construction rather than by care.
 *
 * Framework-free, like the rest of `src/lib`: strings in, integer cents and
 * calendar dates out. What the person typed stays a string until this file
 * says what it is — the form never holds a half-parsed number.
 */
import { z } from "zod";

import type { buildings, units } from "@/db/schema";
import { type CalendarDate, isCalendarDate, isTimeZone } from "@/lib/dates";
import { amount, type FieldErrors, UNREADABLE_FORM } from "@/lib/forms";
import { type Cents, formatMoney } from "@/lib/money";

type BuildingRow = typeof buildings.$inferSelect;
type UnitRow = typeof units.$inferSelect;

export type BasisSplitMethod = NonNullable<BuildingRow["basisSplitMethod"]>;
export type UnitStatus = UnitRow["status"];

/**
 * The form's words for the schema's three values. A `Record` over the
 * schema's own type, so a fourth value added to the column is a type error
 * here until it has a label.
 */
export const BASIS_SPLIT_METHOD_LABELS: Record<BasisSplitMethod, string> = {
  assessment_ratio: "County assessment ratio",
  appraisal: "Appraisal",
  manual: "Entered by hand",
};

const BASIS_SPLIT_METHODS = Object.keys(BASIS_SPLIT_METHOD_LABELS) as [
  BasisSplitMethod,
  ...BasisSplitMethod[],
];

/** One unit's row, as typed. */
export type UnitFields = {
  /** The unit's id on the edit form; null for a row added on this form. */
  id: string | null;
  label: string;
  status: UnitStatus;
  rent: string;
  leaseEnd: string;
};

/** The whole form, as typed: every value a string, as an input holds it. */
export type BuildingFields = {
  label: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  timezone: string;
  buildYear: string;
  units: UnitFields[];
  acquiredOn: string;
  inServiceOn: string;
  purchasePrice: string;
  closingCosts: string;
  landValue: string;
  basisSplitMethod: BasisSplitMethod | "";
  basisSplitNote: string;
};

export type UnitValues = {
  id: string | null;
  label: string;
  status: UnitStatus;
  rentCents: Cents | null;
  leaseEnd: CalendarDate | null;
};

/**
 * The form, as the database will hold it. Every key but `units` is a column
 * of `buildings` under its Drizzle name, so the action writes it as it is.
 */
export type BuildingValues = {
  label: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  region: string;
  postalCode: string;
  timezone: string;
  buildYear: number | null;
  acquiredOn: CalendarDate | null;
  inServiceOn: CalendarDate | null;
  purchasePriceCents: Cents | null;
  closingCostsCents: Cents | null;
  landBasisCents: Cents | null;
  buildingBasisCents: Cents | null;
  basisSplitMethod: BasisSplitMethod | null;
  basisSplitNote: string | null;
  units: UnitValues[];
};

/**
 * Keyed by the field's path, as every form's are (`src/lib/forms.ts`), plus
 * `units`, for the list as a whole.
 */
export type ValidatedBuilding =
  { ok: true; values: BuildingValues } | { ok: false; errors: FieldErrors };

/** The key a unit's field reports its error under. */
export function unitField(
  index: number,
  field: "label" | "rent" | "leaseEnd",
): string {
  return `units.${index}.${field}`;
}

/**
 * The shape a submission has to have before its values are worth reading. A
 * browser running this form cannot fail it, so failing it means the request
 * was not made by the form, and one message covers every way that happens.
 *
 * The lengths are ceilings against a request built by hand, not rules a person
 * meets: nobody's street address is five hundred characters.
 */
const line = z.string().max(500);

const shape = z.object({
  label: line,
  addressLine1: line,
  addressLine2: line,
  city: line,
  region: line,
  postalCode: line,
  timezone: line,
  buildYear: line,
  units: z
    .array(
      z.object({
        id: z.uuid().nullable(),
        label: line,
        status: z.enum(["occupied", "vacant", "retired"]),
        rent: line,
        leaseEnd: line,
      }),
    )
    .max(200),
  acquiredOn: line,
  inServiceOn: line,
  purchasePrice: line,
  closingCosts: line,
  landValue: line,
  basisSplitMethod: z.enum([...BASIS_SPLIT_METHODS, ""]),
  basisSplitNote: z.string().max(2000),
});

/**
 * The building's share of the basis, from the three figures that decide it:
 * the price plus the capitalised closing costs, less the land. `null` until it
 * can be computed, and when it would be negative — the form shows it live, and
 * a negative building value is a land figure to fix rather than a number to
 * show.
 *
 * The one place the arithmetic is written. `validateBuilding` stores what this
 * returns, so the value shown is the value saved, and the three inputs can
 * never disagree with a fourth: the building's value is not a field.
 */
export function buildingValue(
  fields: Pick<BuildingFields, "purchasePrice" | "closingCosts" | "landValue">,
): Cents | null {
  const price = amount(fields.purchasePrice);
  const closing = amount(fields.closingCosts);
  const land = amount(fields.landValue);

  if (price.state !== "ok" || land.state !== "ok" || closing.state === "bad") {
    return null;
  }

  const value =
    price.cents + (closing.state === "ok" ? closing.cents : 0) - land.cents;

  return value >= 0 ? value : null;
}

/**
 * Every rule the form states, in the order the form states them. Returns the
 * values ready to write, or every message at once — never the first one only,
 * because a person fixing a long form one error per submit is the failure the
 * spec's "every failing field's message at once" is about.
 */
export function validateBuilding(input: unknown): ValidatedBuilding {
  const parsed = shape.safeParse(input);
  if (!parsed.success) return { ok: false, errors: { form: UNREADABLE_FORM } };

  const fields = parsed.data;
  const errors: FieldErrors = {};

  function required(
    key: "addressLine1" | "city" | "region" | "postalCode",
    message: string,
  ): string {
    const value = fields[key].trim();
    if (value === "") errors[key] = message;

    return value;
  }

  function optional(value: string): string | null {
    const trimmed = value.trim();

    return trimmed === "" ? null : trimmed;
  }

  function date(raw: string, key: string): CalendarDate | null {
    const value = raw.trim();
    if (value === "") return null;
    if (isCalendarDate(value)) return value;

    errors[key] = "Enter the whole date — day, month and year.";
    return null;
  }

  // Address.
  const addressLine1 = required("addressLine1", "Enter the street address.");
  const city = required("city", "Enter the city.");
  const region = required("region", "Enter the state.");
  const postalCode = required("postalCode", "Enter the ZIP code.");
  const timezone = fields.timezone.trim();
  if (!isTimeZone(timezone)) {
    errors.timezone = "Choose the time zone the building is in.";
  }

  // The building. The database allows 1600 to 2200, and so does this: the
  // range is a typo guard, not an opinion about which buildings are real.
  const rawYear = fields.buildYear.trim();
  let buildYear: number | null = null;
  if (rawYear !== "") {
    const year = Number(rawYear);
    if (/^\d{4}$/.test(rawYear) && year >= 1600 && year <= 2200) {
      buildYear = year;
    } else {
      errors.buildYear = "Enter the year as four digits, like 1924.";
    }
  }

  // Units. At least one that is not retired, because every figure on the
  // building's page is per unit or summed over units. Labels are compared
  // without case: "a" and "A" are distinct to the database's unique
  // constraint and the same unit to anybody reading the page.
  const seen = new Set<string>();
  const unitValues = fields.units.map((unit, index): UnitValues => {
    const label = unit.label.trim();
    const labelKey = label.toLocaleLowerCase("en-US");

    if (label === "") {
      errors[unitField(index, "label")] =
        "Name the unit — A, Upstairs, Unit 2.";
    } else if (seen.has(labelKey)) {
      errors[unitField(index, "label")] = "Give each unit a different name.";
    } else {
      seen.add(labelKey);
    }

    // Rent is asked only of an occupied unit, and required of one: a rent
    // period snapshots it when the month opens (data-model §4), and an
    // occupied unit with no rent would open a month expecting nothing. A
    // vacant unit keeps the asking rent it had, which is why a value there is
    // still read — and still has to be an amount.
    const rent = amount(unit.rent);
    if (rent.state === "bad") {
      errors[unitField(index, "rent")] = rent.message;
    } else if (rent.state === "empty" && unit.status === "occupied") {
      errors[unitField(index, "rent")] =
        "Enter the monthly rent, or mark the unit vacant.";
    }

    return {
      id: unit.id,
      label,
      status: unit.status,
      rentCents: rent.state === "ok" ? rent.cents : null,
      leaseEnd: date(unit.leaseEnd, unitField(index, "leaseEnd")),
    };
  });

  if (!unitValues.some((unit) => unit.status !== "retired")) {
    errors.units = "Add at least one unit.";
  }

  // Purchase and basis: all of it or none of it, which is
  // `buildings_basis_complete` enforced before the database has to.
  const price = amount(fields.purchasePrice);
  const closing = amount(fields.closingCosts);
  const land = amount(fields.landValue);

  if (price.state === "bad") errors.purchasePrice = price.message;
  if (closing.state === "bad") errors.closingCosts = closing.message;
  if (land.state === "bad") errors.landValue = land.message;

  let basis: Pick<
    BuildingValues,
    | "purchasePriceCents"
    | "closingCostsCents"
    | "landBasisCents"
    | "buildingBasisCents"
  > = {
    purchasePriceCents: null,
    closingCostsCents: null,
    landBasisCents: null,
    buildingBasisCents: null,
  };

  if ([price, closing, land].some((figure) => figure.state !== "empty")) {
    if (price.state === "empty") {
      errors.purchasePrice =
        "Enter the purchase price, or clear the other purchase figures.";
    }
    if (land.state === "empty") {
      errors.landValue =
        "Enter the land value, or clear the other purchase figures.";
    }

    if (
      price.state === "ok" &&
      land.state === "ok" &&
      closing.state !== "bad"
    ) {
      const value = buildingValue(fields);

      if (value === null) {
        errors.landValue =
          "Enter a land value no more than the price plus closing costs.";
      } else {
        basis = {
          purchasePriceCents: price.cents,
          closingCostsCents: closing.state === "ok" ? closing.cents : null,
          landBasisCents: land.cents,
          buildingBasisCents: value,
        };
      }
    }
  }

  // Placed in service defaults to the acquisition date, and cannot come
  // before it. `YYYY-MM-DD` compares as a string in calendar order.
  const acquiredOn = date(fields.acquiredOn, "acquiredOn");
  const inServiceOn = date(fields.inServiceOn, "inServiceOn") ?? acquiredOn;
  if (acquiredOn && inServiceOn && inServiceOn < acquiredOn) {
    errors.inServiceOn = "Enter a date on or after the day it was acquired.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    values: {
      label: optional(fields.label),
      addressLine1,
      addressLine2: optional(fields.addressLine2),
      city,
      region,
      postalCode,
      timezone,
      buildYear,
      acquiredOn,
      inServiceOn,
      ...basis,
      basisSplitMethod: fields.basisSplitMethod || null,
      basisSplitNote: optional(fields.basisSplitNote),
      units: unitValues,
    },
  };
}

/**
 * A stored amount, as the field it is edited in. Exact either way — whole
 * dollars as `$1,250`, anything else to the cent — so saving an untouched form
 * writes back the number it read. `formatMoney`'s default would round `$8.50`
 * to `$9` and the next save would store it.
 */
export function moneyField(cents: Cents | null): string {
  if (cents === null) return "";

  return formatMoney(cents, { form: cents % 100 === 0 ? "dollars" : "cents" });
}

/** A new building: one occupied unit labelled `A`, and nothing else typed. */
export function emptyBuildingFields(): BuildingFields {
  return {
    label: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    region: "",
    postalCode: "",
    timezone: "",
    buildYear: "",
    units: [emptyUnitFields("A")],
    acquiredOn: "",
    inServiceOn: "",
    purchasePrice: "",
    closingCosts: "",
    landValue: "",
    basisSplitMethod: "",
    basisSplitNote: "",
  };
}

export function emptyUnitFields(label: string): UnitFields {
  return { id: null, label, status: "occupied", rent: "", leaseEnd: "" };
}

/** The edit form, prefilled from what is stored. */
export function buildingFields(
  building: Omit<BuildingValues, "units">,
  buildingUnits: Pick<
    UnitRow,
    "id" | "label" | "status" | "rentCents" | "leaseEnd"
  >[],
): BuildingFields {
  return {
    label: building.label ?? "",
    addressLine1: building.addressLine1,
    addressLine2: building.addressLine2 ?? "",
    city: building.city,
    region: building.region,
    postalCode: building.postalCode,
    timezone: building.timezone,
    buildYear: building.buildYear === null ? "" : String(building.buildYear),
    units: buildingUnits.map((unit) => ({
      id: unit.id,
      label: unit.label,
      status: unit.status,
      rent: moneyField(unit.rentCents),
      leaseEnd: unit.leaseEnd ?? "",
    })),
    acquiredOn: building.acquiredOn ?? "",
    inServiceOn: building.inServiceOn ?? "",
    purchasePrice: moneyField(building.purchasePriceCents),
    closingCosts: moneyField(building.closingCostsCents),
    landValue: moneyField(building.landBasisCents),
    basisSplitMethod: building.basisSplitMethod ?? "",
    basisSplitNote: building.basisSplitNote ?? "",
  };
}

/**
 * The label `Add another unit` starts a row with, continuing whatever the last
 * row's pattern is: `A` → `B`, `Unit 2` → `Unit 3`, `2` → `3`. Anything else,
 * or a guess that is already taken, starts empty — an empty label asks for a
 * name, where a wrong guess gets saved.
 *
 * Only ever a new row's starting point. Adding a row relabels nothing that is
 * already there (`building-form.md`).
 */
export function nextUnitLabel(labels: readonly string[]): string {
  const last = labels.at(-1)?.trim() ?? "";
  let next = "";

  if (/^[A-Ya-y]$/.test(last)) {
    next = String.fromCharCode(last.charCodeAt(0) + 1);
  } else {
    const numbered = /^(.*?)(\d+)$/.exec(last);
    if (numbered) next = `${numbered[1]}${Number(numbered[2]) + 1}`;
  }

  const taken = labels.some(
    (label) =>
      label.trim().toLocaleLowerCase("en-US") ===
      next.toLocaleLowerCase("en-US"),
  );

  return taken ? "" : next;
}
