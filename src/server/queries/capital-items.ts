/**
 * The capital items' reads: a building's equipment, for the table on its page,
 * and the catalogue the add-equipment checklist offers
 * (`docs/ui/screens/building-detail.md`, `modal-add-equipment.md`).
 * Server-only, and each starts from `getOrgContext()`.
 */
import "server-only";

import { and, asc, eq, max } from "drizzle-orm";

import { capitalItems, capitalItemTypes } from "@/db/schema";
import type { CalendarDate } from "@/lib/dates";
import type { Cents } from "@/lib/money";
import { getOrgContext } from "@/server/org-context";

/**
 * One row of the equipment table: an item, the group of its type, and what the
 * item editor opens on it.
 */
export type EquipmentItem = {
  id: string;
  /** Null for the building's own — `Shared`. */
  unitId: string | null;
  label: string;
  /** The catalogue type it was added from — what the checklist counts as tracked. */
  typeSlug: string | null;
  /** The catalogue group it was added from, or null for one it does not list. */
  group: (typeof capitalItemTypes.$inferSelect)["itemGroup"] | null;
  installYear: number;
  /** Only when audited. */
  installDate: CalendarDate | null;
  confidence: (typeof capitalItems.$inferSelect)["confidence"];
  expectedLifeYears: number;
  replacementCostCents: Cents;
  /** What installing it did cost, when known — the basis. */
  actualCostCents: Cents | null;
  status: (typeof capitalItems.$inferSelect)["status"];
  notes: string | null;
};

/**
 * A building's equipment, every status: the `active` items in service, which
 * are the table's and the forecast's, and the `replaced` and `removed` ones,
 * which `Show replaced and removed` brings back muted (`building-detail.md`).
 * The page splits them; the forecast never sees the history.
 *
 * `buildingId` is one `getBuilding()` has already found in this org, and the
 * org is filtered on again here all the same. In no order: the table sorts
 * within each scope, and only it knows the scopes.
 */
export async function listEquipment(
  buildingId: string,
): Promise<EquipmentItem[]> {
  const { db } = await getOrgContext();

  return await db.run((tx) =>
    tx
      .select({
        id: capitalItems.id,
        unitId: capitalItems.unitId,
        label: capitalItems.label,
        typeSlug: capitalItems.typeSlug,
        group: capitalItemTypes.itemGroup,
        installYear: capitalItems.installYear,
        installDate: capitalItems.installDate,
        confidence: capitalItems.confidence,
        expectedLifeYears: capitalItems.expectedLifeYears,
        replacementCostCents: capitalItems.replacementCostCents,
        actualCostCents: capitalItems.actualCostCents,
        status: capitalItems.status,
        notes: capitalItems.notes,
      })
      .from(capitalItems)
      .leftJoin(
        capitalItemTypes,
        eq(capitalItemTypes.slug, capitalItems.typeSlug),
      )
      .where(
        and(
          eq(capitalItems.orgId, db.orgId),
          eq(capitalItems.buildingId, buildingId),
        ),
      ),
  );
}

/** One type in the checklist, with the defaults an item copies from it. */
export type CatalogueType = Pick<
  typeof capitalItemTypes.$inferSelect,
  | "slug"
  | "label"
  | "itemGroup"
  | "defaultScope"
  | "defaultLifeYears"
  | "defaultCostCents"
>;

export type Catalogue = {
  /** Every type, in the catalogue's order — which is also its groups' order. */
  types: CatalogueType[];
  /**
   * The latest `defaults_updated_at`: the age the modal's footer gives the
   * defaults, PRD §11's visible staleness signal. Null only for an empty
   * catalogue, which a migration seeds.
   */
  defaultsUpdatedAt: CalendarDate | null;
};

/**
 * The whole catalogue. Reference data, so the org decides nothing about what
 * comes back — but it is read through the scoped handle all the same, which
 * is the only handle a query has.
 */
export async function getCatalogue(): Promise<Catalogue> {
  const { db } = await getOrgContext();

  return await db.run(async (tx) => {
    const types = await tx
      .select({
        slug: capitalItemTypes.slug,
        label: capitalItemTypes.label,
        itemGroup: capitalItemTypes.itemGroup,
        defaultScope: capitalItemTypes.defaultScope,
        defaultLifeYears: capitalItemTypes.defaultLifeYears,
        defaultCostCents: capitalItemTypes.defaultCostCents,
      })
      .from(capitalItemTypes)
      .orderBy(asc(capitalItemTypes.sortOrder), asc(capitalItemTypes.slug));

    const [latest] = await tx
      .select({ at: max(capitalItemTypes.defaultsUpdatedAt) })
      .from(capitalItemTypes);

    return { types, defaultsUpdatedAt: latest?.at ?? null };
  });
}
