/**
 * The allocation rule is tax arithmetic: a shared roof's basis, divided across
 * the units of the building it covers, is what F4 depreciates per unit. The
 * cents have to sum to the whole every time, the same inputs have to give the
 * same split every time, and a retired unit must not quietly take a share.
 * `splitCents` has its own tests for the largest-remainder arithmetic; these
 * are about which units, which weights, and which order.
 */
import { describe, expect, it } from "vitest";

import {
  allocateCapitalItem,
  type AllocationUnit,
  rowsForScope,
} from "@/lib/capital-items";

// UUIDv7-shaped, so string order is creation order: A was added first.
const A = "0199a000-0000-7000-8000-000000000001";
const B = "0199a000-0000-7000-8000-000000000002";
const C = "0199a000-0000-7000-8000-000000000003";

const duplex: AllocationUnit[] = [
  { id: A, status: "occupied" },
  { id: B, status: "vacant" },
];

const shared = { unitId: null, allocation: "by_unit_count" as const };

describe("allocateCapitalItem", () => {
  it("divides a shared item evenly, the leftover cent to the first unit", () => {
    // data-model §5's worked example: $10,000.01 across two units.
    expect(allocateCapitalItem(1_000_001, shared, duplex, [])).toEqual({
      building: 0,
      units: [
        { unitId: A, cents: 500_001 },
        { unitId: B, cents: 500_000 },
      ],
    });
  });

  it("gives the same split whatever order the units arrive in", () => {
    // The leftover cent follows the unit, not its position in the list — a
    // query that sorted by label one day and by id the next must not move a
    // cent between two units' Schedule E.
    const units: AllocationUnit[] = [
      { id: C, status: "occupied" },
      { id: A, status: "occupied" },
      { id: B, status: "occupied" },
    ];

    expect(allocateCapitalItem(100, shared, units, [])).toEqual({
      building: 0,
      units: [
        { unitId: A, cents: 34 },
        { unitId: B, cents: 33 },
        { unitId: C, cents: 33 },
      ],
    });
    expect(allocateCapitalItem(100, shared, [...units].reverse(), [])).toEqual(
      allocateCapitalItem(100, shared, units, []),
    );
  });

  it("counts a vacant unit and leaves a retired one out", () => {
    // Vacant is still a leasable space the roof covers; retired is not.
    const units: AllocationUnit[] = [
      { id: A, status: "occupied" },
      { id: B, status: "retired" },
      { id: C, status: "vacant" },
    ];

    expect(allocateCapitalItem(1_850_000, shared, units, [])).toEqual({
      building: 0,
      units: [
        { unitId: A, cents: 925_000 },
        { unitId: C, cents: 925_000 },
      ],
    });
  });

  it("keeps the whole at the building when no unit is left to divide across", () => {
    const retired: AllocationUnit[] = [{ id: A, status: "retired" }];

    expect(allocateCapitalItem(1_850_000, shared, retired, [])).toEqual({
      building: 1_850_000,
      units: [],
    });
    expect(allocateCapitalItem(1_850_000, shared, [], [])).toEqual({
      building: 1_850_000,
      units: [],
    });
  });

  it("gives a unit-scoped item wholly to its unit", () => {
    expect(
      allocateCapitalItem(
        160_000,
        { unitId: B, allocation: "building_only" },
        duplex,
        [],
      ),
    ).toEqual({ building: 0, units: [{ unitId: B, cents: 160_000 }] });
  });

  it("keeps a shared item marked building-only at the building", () => {
    expect(
      allocateCapitalItem(
        590_000,
        { unitId: null, allocation: "building_only" },
        duplex,
        [],
      ),
    ).toEqual({ building: 590_000, units: [] });
  });

  it("divides an explicit split by its basis points", () => {
    const explicit = { unitId: null, allocation: "explicit" as const };

    expect(
      allocateCapitalItem(1_000_001, explicit, duplex, [
        { unitId: B, shareBps: 4000 },
        { unitId: A, shareBps: 6000 },
      ]),
    ).toEqual({
      building: 0,
      units: [
        { unitId: A, cents: 600_001 },
        { unitId: B, cents: 400_000 },
      ],
    });
  });

  it("reads an explicit split as written, a retired unit's share included", () => {
    // The person set these shares; retiring a unit later does not rewrite
    // them, where `by_unit_count` would divide again.
    const units: AllocationUnit[] = [
      { id: A, status: "occupied" },
      { id: B, status: "retired" },
    ];

    expect(
      allocateCapitalItem(
        1000,
        { unitId: null, allocation: "explicit" },
        units,
        [
          { unitId: A, shareBps: 7500 },
          { unitId: B, shareBps: 2500 },
        ],
      ).units,
    ).toEqual([
      { unitId: A, cents: 750 },
      { unitId: B, cents: 250 },
    ]);
  });

  it("always sums to the total", () => {
    const units: AllocationUnit[] = [
      { id: A, status: "occupied" },
      { id: B, status: "occupied" },
      { id: C, status: "occupied" },
    ];
    const shares = [
      { unitId: A, shareBps: 3333 },
      { unitId: B, shareBps: 3333 },
      { unitId: C, shareBps: 3334 },
    ];

    for (const total of [0, 1, 2, 999, 1_000_001, 123_456_789]) {
      for (const allocation of ["by_unit_count", "explicit"] as const) {
        const { building, units: parts } = allocateCapitalItem(
          total,
          { unitId: null, allocation },
          units,
          shares,
        );

        expect(building + parts.reduce((sum, p) => sum + p.cents, 0)).toBe(
          total,
        );
      }
    }
  });

  it("refuses an explicit split that does not sum to the whole", () => {
    // The database refuses one at commit; a split computed from one anyway
    // would be a wrong number on a tax page.
    expect(() =>
      allocateCapitalItem(
        1000,
        { unitId: null, allocation: "explicit" },
        duplex,
        [{ unitId: A, shareBps: 6000 }],
      ),
    ).toThrow(RangeError);
  });

  it("refuses to divide a unit-scoped item", () => {
    expect(() =>
      allocateCapitalItem(
        1000,
        { unitId: A, allocation: "by_unit_count" },
        duplex,
        [],
      ),
    ).toThrow(RangeError);
  });
});

describe("rowsForScope", () => {
  const building: AllocationUnit[] = [
    { id: A, status: "occupied" },
    { id: B, status: "vacant" },
    { id: C, status: "retired" },
  ];

  it("makes one row per unit that is not retired for each unit", () => {
    expect(rowsForScope("each", building)).toEqual([
      { unitId: A, allocation: "building_only" },
      { unitId: B, allocation: "building_only" },
    ]);
  });

  it("makes one building row, divided by unit count, when shared", () => {
    expect(rowsForScope("shared", building)).toEqual([
      { unitId: null, allocation: "by_unit_count" },
    ]);
  });

  it("makes one row for a named unit", () => {
    expect(rowsForScope({ unitId: B }, building)).toEqual([
      { unitId: B, allocation: "building_only" },
    ]);
  });

  it("refuses a retired unit, and one that is not the building's", () => {
    expect(rowsForScope({ unitId: C }, building)).toBeNull();
    expect(
      rowsForScope(
        { unitId: "0199a000-0000-7000-8000-000000000009" },
        building,
      ),
    ).toBeNull();
  });

  it("makes no rows for each unit when every unit is retired", () => {
    expect(rowsForScope("each", [{ id: A, status: "retired" }])).toEqual([]);
  });
});
