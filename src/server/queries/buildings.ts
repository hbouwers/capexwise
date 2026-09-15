/**
 * Every read of `buildings` and `units` a screen makes: the portfolio's cards,
 * a building's page, the edit form. Server-only, and each one starts from
 * `getOrgContext()` — which is cached per request, so a page that calls two of
 * these resolves its org once.
 *
 * Every query filters on `db.orgId` as well as running through the scoped
 * handle. Row-level security would hide another org's rows without the
 * filter; `src/server/org-context.ts` says why it is written anyway.
 */
import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { cache } from "react";
import { z } from "zod";

import {
  buildings,
  capitalItemAllocations,
  capitalItems,
  rentPeriods,
  units,
} from "@/db/schema";
import { compareUnitLabels } from "@/lib/buildings";
import { getOrgContext } from "@/server/org-context";

/** One building card on the portfolio (`docs/ui/screens/portfolio.md`). */
export type BuildingSummary = {
  id: string;
  label: string | null;
  addressLine1: string;
  city: string;
  buildYear: number | null;
  status: (typeof buildings.$inferSelect)["status"];
  /** Units that are not retired. */
  unitCount: number;
  occupiedCount: number;
  /** The current rent of the occupied units — what a month is expected to bring. */
  rentCents: number;
};

/**
 * Every building in the org, in the portfolio's order — by name, then by
 * address, where the name falls back to the address as it does on the card.
 * Archived and sold buildings are included, and the screen decides where they
 * go; the counts on each are the building's own.
 *
 * One query rather than a query per card: the unit figures are aggregated in
 * the join. The join names the org on both sides, which is `units_building`'s
 * shape and lets the planner lead with `org_id` on each table.
 */
export async function listBuildings(): Promise<BuildingSummary[]> {
  const { db } = await getOrgContext();

  return await db.run((tx) =>
    tx
      .select({
        id: buildings.id,
        label: buildings.label,
        addressLine1: buildings.addressLine1,
        city: buildings.city,
        buildYear: buildings.buildYear,
        status: buildings.status,
        unitCount:
          sql<number>`count(${units.id}) filter (where ${units.status} <> 'retired')`.mapWith(
            Number,
          ),
        occupiedCount:
          sql<number>`count(${units.id}) filter (where ${units.status} = 'occupied')`.mapWith(
            Number,
          ),
        // `sum` of a `bigint` is a `numeric`, which the driver hands back as a
        // string. Integer cents under 2^53 read back exactly as a number.
        rentCents:
          sql<number>`coalesce(sum(${units.rentCents}) filter (where ${units.status} = 'occupied'), 0)`.mapWith(
            Number,
          ),
      })
      .from(buildings)
      .leftJoin(
        units,
        and(
          eq(units.orgId, buildings.orgId),
          eq(units.buildingId, buildings.id),
        ),
      )
      .where(eq(buildings.orgId, db.orgId))
      .groupBy(buildings.id)
      .orderBy(
        asc(
          sql`lower(coalesce(${buildings.label}, ${buildings.addressLine1}))`,
        ),
        asc(sql`lower(${buildings.addressLine1})`),
        asc(buildings.id),
      ),
  );
}

export type BuildingRecord = typeof buildings.$inferSelect;

export type UnitRecord = Pick<
  typeof units.$inferSelect,
  "id" | "label" | "status" | "rentCents" | "leaseEnd"
> & {
  /**
   * Whether any month of rent has been opened for it. A unit with history is
   * retired rather than removed (`docs/data-model.md` §7), so the edit form
   * offers `Retire` in its place.
   */
  hasRentHistory: boolean;
  /**
   * Whether it has equipment of its own, or a share of a shared item split
   * explicitly — history as much as rent is (§7), so it is retired too.
   */
  hasEquipment: boolean;
};

export type BuildingDetail = {
  building: BuildingRecord;
  /** Every unit, retired ones included, in label order. */
  units: UnitRecord[];
};

/**
 * `z.uuid()` rather than a cast in SQL: a malformed id in a URL is a building
 * that does not exist, and it should be told apart from one before it reaches
 * Postgres, which would raise `invalid input syntax for type uuid` — a 500 for
 * what is a 404.
 */
const buildingIdSchema = z.uuid();

/**
 * One building and its units, or `null` — for an id that does not exist, one
 * that is not an id, and one that belongs to another org alike. The screens
 * render the same 404 for all three (`docs/ui/screens/README.md`), so a URL
 * cannot be used to learn whether an id exists anywhere.
 *
 * `unknown`, because the id comes from a URL. Memoised per request, like
 * `getOrgContext()`, so a page's title and its body read the building once.
 */
export const getBuilding = cache(async function getBuilding(
  buildingId: unknown,
): Promise<BuildingDetail | null> {
  const { db } = await getOrgContext();

  const id = buildingIdSchema.safeParse(buildingId);
  if (!id.success) return null;

  return await db.run(async (tx) => {
    const [building] = await tx
      .select()
      .from(buildings)
      .where(and(eq(buildings.orgId, db.orgId), eq(buildings.id, id.data)));

    if (!building) return null;

    const rows = await tx
      .select({
        id: units.id,
        label: units.label,
        status: units.status,
        rentCents: units.rentCents,
        leaseEnd: units.leaseEnd,
      })
      .from(units)
      .where(and(eq(units.orgId, db.orgId), eq(units.buildingId, building.id)));

    // Which of them any month of rent has been opened for — the building's
    // periods, by its own index, rather than a probe per unit.
    const historic = await tx
      .selectDistinct({ unitId: rentPeriods.unitId })
      .from(rentPeriods)
      .where(
        and(
          eq(rentPeriods.orgId, db.orgId),
          eq(rentPeriods.buildingId, building.id),
        ),
      );
    const withHistory = new Set(historic.map((row) => row.unitId));

    // And which of them hold equipment, by the building's items and shares.
    const equipped = new Set(
      [
        ...(await tx
          .selectDistinct({ unitId: capitalItems.unitId })
          .from(capitalItems)
          .where(
            and(
              eq(capitalItems.orgId, db.orgId),
              eq(capitalItems.buildingId, building.id),
            ),
          )),
        ...(await tx
          .selectDistinct({ unitId: capitalItemAllocations.unitId })
          .from(capitalItemAllocations)
          .where(
            and(
              eq(capitalItemAllocations.orgId, db.orgId),
              eq(capitalItemAllocations.buildingId, building.id),
            ),
          )),
      ].map((row) => row.unitId),
    );

    // Sorted here rather than in SQL: "Unit 10" after "Unit 9" is a collation
    // Postgres's default does not do, and `compareUnitLabels` is the one the
    // rest of the product uses.
    const unitRecords = rows
      .map((unit) => ({
        ...unit,
        hasRentHistory: withHistory.has(unit.id),
        hasEquipment: equipped.has(unit.id),
      }))
      .sort((a, b) => compareUnitLabels(a.label, b.label));

    return { building, units: unitRecords };
  });
});
