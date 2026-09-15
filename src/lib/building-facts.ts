/**
 * The facts card's words and its one sum (`docs/ui/screens/building-detail.md`,
 * Building facts): what each day, utility and code kind is called, and the
 * owner-paid total. Framework-free, like the rest of `src/lib`, and imported
 * by the card and the editor alike.
 *
 * The lists are `Record`s over the schema's own types, so a value added to a
 * column is a type error here until it has a name. Types only from the schema:
 * a value import would put Drizzle in the browser's bundle.
 */
import type {
  buildingAccessCodes,
  buildingFacts,
  buildingUtilities,
} from "@/db/schema";
import type { Cents } from "@/lib/money";

export type Weekday = NonNullable<
  (typeof buildingFacts.$inferSelect)["trashDay"]
>;
export type UtilityKind = (typeof buildingUtilities.$inferSelect)["kind"];
export type PaidBy = (typeof buildingUtilities.$inferSelect)["paidBy"];
export type AccessCodeKind = (typeof buildingAccessCodes.$inferSelect)["kind"];

/** In the week's order, Monday first, as the day `Select`s list them. */
export const WEEKDAY_NAMES: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export const UTILITY_KIND_LABELS: Record<UtilityKind, string> = {
  gas: "Gas",
  electric: "Electric",
  water_sewer: "Water & sewer",
  internet: "Internet",
  trash: "Trash",
  lawn: "Lawn care",
  snow: "Snow removal",
  other: "Other",
};

/**
 * The two kinds the card lists under **Services**, with the person to call,
 * rather than under **Utility accounts** with an account number. The rest are
 * accounts.
 */
export const SERVICE_KINDS: readonly UtilityKind[] = ["lawn", "snow"];

export const ACCOUNT_KINDS: readonly UtilityKind[] = (
  Object.keys(UTILITY_KIND_LABELS) as UtilityKind[]
).filter((kind) => !SERVICE_KINDS.includes(kind));

export function isService(kind: UtilityKind): boolean {
  return SERVICE_KINDS.includes(kind);
}

export const ACCESS_CODE_KIND_LABELS: Record<AccessCodeKind, string> = {
  smart_lock: "Smart lock",
  door: "Door code",
  lockbox: "Lockbox",
  garage: "Garage code",
  gate: "Gate code",
  other: "Other code",
};

/**
 * A code's name on the card: its label and its kind — `Rear door · door
 * code` — or the kind alone when it has no label.
 */
export function accessCodeName(code: {
  label: string | null;
  kind: AccessCodeKind;
}): string {
  const kind = ACCESS_CODE_KIND_LABELS[code.kind];

  return code.label ? `${code.label} · ${kind.toLowerCase()}` : kind;
}

/**
 * What the owner pays a month for the building's utilities and services: the
 * averages of the rows the owner pays, and only those. A tenant-paid bill is
 * listed on the card, because it helps price a unit, and is not in this total,
 * because the owner does not pay it. A row with no average adds nothing — it
 * is not a bill of $0, it is a bill nobody has entered.
 */
export function ownerPaidMonthlyCents(
  utilities: readonly { paidBy: PaidBy; avgMonthlyCents: Cents | null }[],
): Cents {
  return utilities.reduce(
    (sum, utility) =>
      utility.paidBy === "owner" && utility.avgMonthlyCents !== null
        ? sum + utility.avgMonthlyCents
        : sum,
    0,
  );
}

/**
 * How long a revealed code stays on screen (`components.md` §9). A reveal is an
 * event with a record behind it, and a code left showing indefinitely would
 * make the record describe less than happened.
 */
export const REVEAL_SECONDS = 60;
