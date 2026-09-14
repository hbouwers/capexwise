/**
 * How a building and its units are named and ordered, wherever they appear —
 * the portfolio's cards, a building's own page, the form. Small, and in one
 * place so the rule for a building's name cannot drift between the three.
 */

/**
 * A building's name: its label, or the street address when it has none
 * (`docs/ui/screens/building-form.md`). Never "Untitled building" — the address
 * is a name the owner already uses.
 */
export function buildingName(building: {
  label: string | null;
  addressLine1: string;
}): string {
  return building.label ?? building.addressLine1;
}

/**
 * Unit labels in the order a person reads them: "Unit 2" before "Unit 10",
 * and "a" beside "A" rather than after "Z". A fixed locale for the reason
 * `formatDate` gives — the server and every browser must agree.
 */
const collator = new Intl.Collator("en-US", {
  numeric: true,
  sensitivity: "base",
});

export function compareUnitLabels(a: string, b: string): number {
  return collator.compare(a, b);
}

/**
 * `4 units`, `1 unit`. For a count inside a sentence — a subtitle, a card's
 * meta line — where the number stays in the sentence's font.
 */
export function unitCount(n: number): string {
  return n === 1 ? "1 unit" : `${n} units`;
}

type Address = {
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  region: string;
  postalCode: string;
};

/** `Indianapolis, IN 46204`. */
export function cityLine(address: Address): string {
  return `${address.city}, ${address.region} ${address.postalCode}`;
}

/** `412 N Delaware St, Rear, Indianapolis, IN 46204` — the address on one line. */
export function fullAddress(address: Address): string {
  return [address.addressLine1, address.addressLine2, cityLine(address)]
    .filter(Boolean)
    .join(", ");
}
