import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AddEquipment } from "@/components/buildings/add-equipment";
import { BuildingFactsCard } from "@/components/buildings/building-facts-card";
import {
  EquipmentCard,
  type EquipmentView,
} from "@/components/buildings/equipment-card";
import { RentRollCard } from "@/components/buildings/rent-roll";
import { Money } from "@/components/money";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { StatTile, StatTiles } from "@/components/stat-tile";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  buildingName,
  cityLine,
  fullAddress,
  unitCount,
} from "@/lib/buildings";
import { todayIn, yearOf } from "@/lib/dates";
import { getBuildingFacts } from "@/server/queries/building-facts";
import { getBuilding } from "@/server/queries/buildings";
import { getCatalogue, listEquipment } from "@/server/queries/capital-items";
import { listContacts } from "@/server/queries/contacts";
import { getRentRoll } from "@/server/queries/rent-periods";

/**
 * A building's page (`docs/ui/screens/building-detail.md`): its header, the
 * Summary's `Rent / mo` tile, the rent roll for the month in `?month=`, its
 * facts, and its equipment, filtered by `?scope=` and `?confidence=`. The
 * recurring tasks come with the issue that stores them, and the Summary's
 * capital tiles and the replacement runway with the forecast (#111), whose
 * module they read.
 *
 * `getBuilding()` answers `null` for an id that does not exist, one that is not
 * an id, and one in another org, and all three are the same 404.
 */
export async function generateMetadata({
  params,
}: PageProps<"/buildings/[buildingId]">): Promise<Metadata> {
  const detail = await getBuilding((await params).buildingId);

  return {
    title: `${detail ? buildingName(detail.building) : "Not found"} — CapExWise`,
  };
}

export default async function BuildingPage({
  params,
  searchParams,
}: PageProps<"/buildings/[buildingId]">) {
  const detail = await getBuilding((await params).buildingId);
  if (!detail) notFound();

  const { building } = detail;
  const query = await searchParams;
  const editable = building.status === "active";
  const [facts, contacts, roll, equipment, catalogue] = await Promise.all([
    getBuildingFacts(building.id),
    listContacts(),
    getRentRoll(building.id, query.month),
    listEquipment(building.id),
    // The checklist is only offered on an active building.
    editable ? getCatalogue() : null,
  ]);
  // Read through `getBuilding`, which has just found the building.
  if (!roll) notFound();
  // Retired units are history, not part of the building's figures.
  const units = detail.units.filter((unit) => unit.status !== "retired");
  const occupied = units.filter((unit) => unit.status === "occupied");
  const rentCents = occupied.reduce(
    (sum, unit) => sum + (unit.rentCents ?? 0),
    0,
  );

  const subtitle = [
    building.label === null ? cityLine(building) : fullAddress(building),
    unitCount(units.length),
    building.buildYear === null ? null : `built ${building.buildYear}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const today = todayIn(building.timezone);
  const thisYear = yearOf(today);

  const tracked: Record<string, number> = {};
  for (const item of equipment) {
    if (item.typeSlug)
      tracked[item.typeSlug] = (tracked[item.typeSlug] ?? 0) + 1;
  }

  const addEquipment = (variant: "default" | "outline") =>
    catalogue ? (
      <AddEquipment
        building={{
          id: building.id,
          name: buildingName(building),
          buildYear: building.buildYear,
        }}
        units={units.map((unit) => ({ id: unit.id, label: unit.label }))}
        types={catalogue.types}
        defaultsUpdatedAt={catalogue.defaultsUpdatedAt}
        tracked={tracked}
        thisYear={thisYear}
        variant={variant}
      />
    ) : null;

  const occupancy =
    occupied.length === units.length
      ? `${unitCount(units.length)} · all occupied`
      : `${occupied.length} of ${units.length} occupied`;

  return (
    <>
      <PageHeader
        title={buildingName(building)}
        subtitle={subtitle}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/buildings/${building.id}/edit`}>Edit building</Link>
            </Button>
            {addEquipment("default")}
          </>
        }
      />
      <PageBody>
        <div className="flex flex-col gap-6">
          <Link
            href="/"
            className="self-start text-xs text-text-tertiary underline-offset-4 hover:text-text-primary hover:underline"
          >
            ← All buildings
          </Link>

          {building.status === "active" ? null : (
            <p className="rounded-lg border border-border-card bg-surface-subtle px-4 py-3 text-sm leading-normal text-text-secondary">
              {building.status === "sold" ? "Sold." : "Archived."} Kept for its
              history; it is left out of the portfolio&rsquo;s figures.
            </p>
          )}

          <section aria-label="Summary" className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <StatusBadge variant="neutral">{occupancy}</StatusBadge>
              {building.status === "active" ? null : (
                <StatusBadge variant="neutral">
                  {building.status === "sold" ? "Sold" : "Archived"}
                </StatusBadge>
              )}
            </div>
            <StatTiles>
              <StatTile
                label="Rent / mo"
                figure={<Money cents={rentCents} />}
                sub={`${occupied.length} of ${unitCount(units.length)} occupied`}
                href="#units"
              />
            </StatTiles>
          </section>

          <RentRollCard buildingId={building.id} roll={roll} />

          <BuildingFactsCard
            buildingId={building.id}
            timezone={building.timezone}
            facts={facts}
            units={detail.units.map((unit) => ({
              id: unit.id,
              label: unit.label,
              retired: unit.status === "retired",
            }))}
            contacts={contacts.map((contact) => ({
              id: contact.id,
              name: contact.name,
              company: contact.company,
              archived: contact.archivedAt !== null,
            }))}
          />

          <EquipmentCard
            items={equipment}
            units={detail.units.map((unit) => ({
              id: unit.id,
              label: unit.label,
              retired: unit.status === "retired",
            }))}
            view={equipmentView(query, detail.units)}
            thisYear={thisYear}
            today={today}
            editable={editable}
            addEquipment={addEquipment(
              equipment.length === 0 ? "default" : "outline",
            )}
          />
        </div>
      </PageBody>
    </>
  );
}

/**
 * The equipment table's filters, from the URL: `?scope=shared` or a unit of
 * this building, and `?confidence=estimated`. Anything else — an array, a
 * unit of another building — is no filter, rather than an error.
 */
function equipmentView(
  query: Record<string, string | string[] | undefined>,
  units: readonly { id: string }[],
): EquipmentView {
  const scope = query.scope;

  return {
    scope:
      scope === "shared" || units.some((unit) => unit.id === scope)
        ? (scope as string)
        : null,
    estimatedOnly: query.confidence === "estimated",
  };
}
