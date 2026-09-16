/**
 * The capital items' rules that are arithmetic rather than storage: how a
 * shared item's cost divides across a building's units, and which rows one
 * tick of the add-equipment checklist becomes. `docs/data-model.md` §5 is the
 * decision; this is the one place it is computed, so the tax planner and
 * anything else that shows a split get the same cents.
 *
 * Framework-free and database-free, like the rest of `src/lib/`.
 */
import { type Cents, splitCents } from "@/lib/money";

export type AllocationMethod = "building_only" | "by_unit_count" | "explicit";

export type UnitStatus = "occupied" | "vacant" | "retired";

/** A building's unit, as much of it as the rules read. */
export type AllocationUnit = { id: string; status: UnitStatus };

/** One unit's share of an explicit split, in basis points. */
export type AllocationShare = { unitId: string; shareBps: number };

/**
 * Where an item's cost sits once divided: some with the building itself, the
 * rest with its units. The two always sum to the total.
 */
export type Allocation = {
  building: Cents;
  /** Each unit's part, in `id` order — creation order, since ids are UUIDv7. */
  units: { unitId: string; cents: Cents }[];
};

/**
 * **Derived when read, from the stored rule** — never stored as a number,
 * because a stored split goes stale the moment a unit is added or retired
 * (§5). A filed tax year freezes what this said then (#44); everything live
 * asks again.
 *
 * - **Unit-scoped**: all of it is that unit's. Its rule is `building_only`,
 *   which the schema requires of an item with a unit.
 * - **`building_only`**, shared: all of it stays with the building.
 * - **`by_unit_count`**: evenly across the building's units that are not
 *   retired, by largest remainder, so the parts sum to the total exactly —
 *   $10,000.01 across two units is $5,000.01 and $5,000.00. The earliest unit
 *   takes the first leftover cent, whatever order the units arrive in. With no such unit there is nothing to divide across, and it
 *   stays with the building.
 * - **`explicit`**: by the stored shares, which the database holds to 10000
 *   basis points. They are the person's statement and are read as written,
 *   a retired unit's share included.
 *
 * `total` is whichever figure is being divided — a basis, a replacement cost.
 * Throws where the inputs break a rule the schema keeps, because a split
 * computed from them would be a wrong number on a tax page.
 */
export function allocateCapitalItem(
  total: Cents,
  item: { unitId: string | null; allocation: AllocationMethod },
  units: readonly AllocationUnit[],
  shares: readonly AllocationShare[],
): Allocation {
  if (item.unitId !== null) {
    if (item.allocation !== "building_only") {
      throw new RangeError("A unit-scoped item is not divided.");
    }

    return { building: 0, units: [{ unitId: item.unitId, cents: total }] };
  }

  switch (item.allocation) {
    case "building_only":
      return { building: total, units: [] };

    case "by_unit_count": {
      const eligible = units
        .filter((unit) => unit.status !== "retired")
        .map((unit) => unit.id)
        .sort(byId);

      if (eligible.length === 0) return { building: total, units: [] };

      const parts = splitCents(
        total,
        eligible.map(() => 1),
      );

      return {
        building: 0,
        units: eligible.map((unitId, index) => ({
          unitId,
          cents: parts[index]!,
        })),
      };
    }

    case "explicit": {
      const ordered = [...shares].sort((a, b) => byId(a.unitId, b.unitId));
      const sum = ordered.reduce((acc, share) => acc + share.shareBps, 0);

      if (sum !== 10_000) {
        throw new RangeError(
          `An explicit split sums to 10000 basis points, got ${sum}.`,
        );
      }

      const parts = splitCents(
        total,
        ordered.map((share) => share.shareBps),
      );

      return {
        building: 0,
        units: ordered.map((share, index) => ({
          unitId: share.unitId,
          cents: parts[index]!,
        })),
      };
    }
  }
}

/**
 * Ids compared as strings, not with `localeCompare`: a UUIDv7 is fixed-width
 * lowercase hex led by its timestamp, so string order is creation order, and
 * it is the same in every runtime.
 */
function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * What the checklist's scope choice for a ticked item asks for
 * (`docs/ui/screens/modal-add-equipment.md`, Scope):
 *
 * - `each`: one item per unit that is not retired, each scoped to it;
 * - `shared`: one item for the building, divided by unit count;
 * - a unit's id: one item scoped to that unit.
 */
export type ScopeChoice = "each" | "shared" | { unitId: string };

/** One row the choice becomes: its unit, or null for the building's. */
export type ScopedRow = { unitId: string | null; allocation: AllocationMethod };

/**
 * The rows one ticked item becomes on a building with these units. `null`
 * when the choice names a unit that is not one of them or is retired — a unit
 * that stopped being a leasable space gets no new equipment. `each` on a
 * building with no unit left is no rows, which the caller refuses.
 */
export function rowsForScope(
  choice: ScopeChoice,
  units: readonly AllocationUnit[],
): ScopedRow[] | null {
  const open = units.filter((unit) => unit.status !== "retired");

  if (choice === "shared") {
    return [{ unitId: null, allocation: "by_unit_count" }];
  }

  if (choice === "each") {
    return open.map((unit) => ({
      unitId: unit.id,
      allocation: "building_only",
    }));
  }

  return open.some((unit) => unit.id === choice.unitId)
    ? [{ unitId: choice.unitId, allocation: "building_only" }]
    : null;
}

/**
 * What a catalogue group is called: the checklist's group headings, and an
 * item's category in the equipment table. Keyed by `item_group`, whose check
 * constraint lists the same five.
 */
export const CAPITAL_ITEM_GROUP_LABELS: Record<string, string> = {
  kitchen: "Kitchen",
  laundry: "Laundry",
  hvac_water: "HVAC & water",
  envelope: "Envelope",
  interior_systems: "Interior & systems",
};
