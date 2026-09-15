/**
 * The facts editor's rules, once, for both sides of it
 * (`docs/ui/screens/building-detail.md`, Building facts). The browser runs
 * `validateBuildingFacts` before it sends anything and the server action runs
 * it again on whatever arrives — `building-form.ts` says why one function
 * serves both.
 *
 * Framework-free. It knows the shape of a unit's or a contact's id but not
 * which ones exist, which is the action's to check inside the org.
 *
 * **An access code is never prefilled.** The editor would have to open every
 * code to render the form, so an existing code's field starts empty and an
 * empty field keeps the code — `code: null` in the values. A new code has no
 * code to keep, so its field is required.
 */
import { z } from "zod";

import {
  ACCESS_CODE_KIND_LABELS,
  type AccessCodeKind,
  isService,
  type PaidBy,
  UTILITY_KIND_LABELS,
  type UtilityKind,
  WEEKDAY_NAMES,
  type Weekday,
} from "@/lib/building-facts";
import { moneyField } from "@/lib/building-form";
import { amount, type FieldErrors, UNREADABLE_FORM } from "@/lib/forms";
import type { Cents } from "@/lib/money";

/**
 * The longest code the cipher seals, in bytes of UTF-8: one 64-byte block less
 * its length byte. `MAX_CODE_BYTES` in `access-code-cipher.mts`, which this
 * cannot import — it is `node:crypto`, and this file runs in the browser — so
 * a test holds the two together.
 */
export const MAX_CODE_LENGTH = 63;

/** One code's row, as typed. */
export type AccessCodeFields = {
  /** The code's id when it is stored; null for a row added in this editor. */
  id: string | null;
  kind: AccessCodeKind;
  label: string;
  /** A unit's id, or "" for the whole building. */
  unitId: string;
  /** Always "" to start with — see the module comment. */
  code: string;
};

/** One utility or service, as typed. */
export type UtilityFields = {
  id: string | null;
  kind: UtilityKind;
  unitId: string;
  providerName: string;
  accountRef: string;
  paidBy: PaidBy;
  avgMonthly: string;
  /** A contact's id, or "" for nobody. */
  contactId: string;
};

export type BuildingFactsFields = {
  trashDay: Weekday | "";
  recyclingDay: Weekday | "";
  recyclingNote: string;
  accessCodes: AccessCodeFields[];
  /** Services and accounts together; the editor shows them apart by kind. */
  utilities: UtilityFields[];
};

export type AccessCodeValues = {
  id: string | null;
  kind: AccessCodeKind;
  label: string | null;
  unitId: string | null;
  /** The new code, or null to keep the stored one. Never null for a new row. */
  code: string | null;
};

/** Every key but `id` is a column of `building_utilities` under its name. */
export type UtilityValues = {
  id: string | null;
  kind: UtilityKind;
  unitId: string | null;
  providerName: string | null;
  accountRef: string | null;
  paidBy: PaidBy;
  avgMonthlyCents: Cents | null;
  contactId: string | null;
};

export type BuildingFactsValues = {
  trashDay: Weekday | null;
  recyclingDay: Weekday | null;
  recyclingNote: string | null;
  accessCodes: AccessCodeValues[];
  utilities: UtilityValues[];
};

export type ValidatedBuildingFacts =
  | { ok: true; values: BuildingFactsValues }
  | { ok: false; errors: FieldErrors };

export function codeField(index: number, field: "code" | "label"): string {
  return `accessCodes.${index}.${field}`;
}

export function utilityField(
  index: number,
  field: "providerName" | "accountRef" | "avgMonthly",
): string {
  return `utilities.${index}.${field}`;
}

const WEEKDAYS = Object.keys(WEEKDAY_NAMES) as [Weekday, ...Weekday[]];
const UTILITY_KINDS = Object.keys(UTILITY_KIND_LABELS) as [
  UtilityKind,
  ...UtilityKind[],
];
const CODE_KINDS = Object.keys(ACCESS_CODE_KIND_LABELS) as [
  AccessCodeKind,
  ...AccessCodeKind[],
];

/**
 * The shape a submission has to have before its values are worth reading.
 * The lengths are ceilings against a request built by hand, not rules a person
 * meets; fifty codes is not a building anybody owns.
 */
const line = z.string().max(500);
const idOrNone = z.union([z.uuid(), z.literal("")]);

const shape = z.object({
  trashDay: z.enum([...WEEKDAYS, ""]),
  recyclingDay: z.enum([...WEEKDAYS, ""]),
  recyclingNote: line,
  accessCodes: z
    .array(
      z.object({
        id: z.uuid().nullable(),
        kind: z.enum(CODE_KINDS),
        label: line,
        unitId: idOrNone,
        code: line,
      }),
    )
    .max(50),
  utilities: z
    .array(
      z.object({
        id: z.uuid().nullable(),
        kind: z.enum(UTILITY_KINDS),
        unitId: idOrNone,
        providerName: line,
        accountRef: line,
        paidBy: z.enum(["owner", "tenant"]),
        avgMonthly: line,
        contactId: idOrNone,
      }),
    )
    .max(50),
});

function optional(value: string): string | null {
  const trimmed = value.trim();

  return trimmed === "" ? null : trimmed;
}

/**
 * Every rule the editor states, or every message at once. `building-form.ts`
 * says why never the first one only.
 */
export function validateBuildingFacts(input: unknown): ValidatedBuildingFacts {
  const parsed = shape.safeParse(input);
  if (!parsed.success) return { ok: false, errors: { form: UNREADABLE_FORM } };

  const fields = parsed.data;
  const errors: FieldErrors = {};

  const accessCodes = fields.accessCodes.map((row, index): AccessCodeValues => {
    // Trimmed: a space pasted on the end of a keypad code is a typo, and
    // a door does not have a space key.
    const code = row.code.trim();

    if (code === "" && row.id === null) {
      errors[codeField(index, "code")] = "Enter the code.";
    } else if (new TextEncoder().encode(code).length > MAX_CODE_LENGTH) {
      errors[codeField(index, "code")] =
        `Enter a code of ${MAX_CODE_LENGTH} characters or fewer.`;
    }

    return {
      id: row.id,
      kind: row.kind,
      label: optional(row.label),
      unitId: row.unitId || null,
      code: code === "" ? null : code,
    };
  });

  const utilities = fields.utilities.map((row, index): UtilityValues => {
    const providerName = optional(row.providerName);
    const contactId = row.contactId || null;

    // A service is often one person with a mower, so the contact alone will
    // do. An account is a company that sends a bill, and is named by it.
    if (isService(row.kind)) {
      if (providerName === null && contactId === null) {
        errors[utilityField(index, "providerName")] =
          "Enter the company, or choose a contact.";
      }
    } else if (providerName === null) {
      errors[utilityField(index, "providerName")] =
        "Enter the provider — AES Indiana, Citizens Energy.";
    }

    // The schema's check, said first: a full account number is refused, not
    // stored (ADR-0008). Counted in code points, as `char_length` counts.
    const accountRef = optional(row.accountRef);
    if (accountRef !== null && [...accountRef].length > 4) {
      errors[utilityField(index, "accountRef")] =
        "Enter only the last four characters of the account number.";
    }

    const average = amount(row.avgMonthly);
    if (average.state === "bad") {
      errors[utilityField(index, "avgMonthly")] = average.message;
    }

    return {
      id: row.id,
      kind: row.kind,
      unitId: row.unitId || null,
      providerName,
      accountRef,
      paidBy: row.paidBy,
      avgMonthlyCents: average.state === "ok" ? average.cents : null,
      contactId,
    };
  });

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    values: {
      trashDay: fields.trashDay || null,
      recyclingDay: fields.recyclingDay || null,
      recyclingNote: optional(fields.recyclingNote),
      accessCodes,
      utilities,
    },
  };
}

export function emptyAccessCodeFields(): AccessCodeFields {
  return { id: null, kind: "door", label: "", unitId: "", code: "" };
}

export function emptyUtilityFields(kind: UtilityKind): UtilityFields {
  return {
    id: null,
    kind,
    unitId: "",
    providerName: "",
    accountRef: "",
    paidBy: "owner",
    avgMonthly: "",
    contactId: "",
  };
}

/** The editor, prefilled from what is stored — every code's field empty. */
export function buildingFactsFields(stored: {
  trashDay: Weekday | null;
  recyclingDay: Weekday | null;
  recyclingNote: string | null;
  accessCodes: readonly {
    id: string;
    kind: AccessCodeKind;
    label: string | null;
    unitId: string | null;
  }[];
  utilities: readonly {
    id: string;
    kind: UtilityKind;
    unitId: string | null;
    providerName: string | null;
    accountRef: string | null;
    paidBy: PaidBy;
    avgMonthlyCents: Cents | null;
    contact: { id: string } | null;
  }[];
}): BuildingFactsFields {
  return {
    trashDay: stored.trashDay ?? "",
    recyclingDay: stored.recyclingDay ?? "",
    recyclingNote: stored.recyclingNote ?? "",
    accessCodes: stored.accessCodes.map((code) => ({
      id: code.id,
      kind: code.kind,
      label: code.label ?? "",
      unitId: code.unitId ?? "",
      code: "",
    })),
    utilities: stored.utilities.map((utility) => ({
      id: utility.id,
      kind: utility.kind,
      unitId: utility.unitId ?? "",
      providerName: utility.providerName ?? "",
      accountRef: utility.accountRef ?? "",
      paidBy: utility.paidBy,
      avgMonthly: moneyField(utility.avgMonthlyCents),
      contactId: utility.contact?.id ?? "",
    })),
  };
}
