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
import { RunwayList } from "@/components/runway-list";
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
import { lifeStatus, replacementYear } from "@/lib/forecast/life";
import {
  type ForecastItem,
  levelFundingPerMonthCents,
  outflowByYear,
  replacements,
} from "@/lib/forecast/outflow";
import { getBuildingFacts } from "@/server/queries/building-facts";
import { getBuilding } from "@/server/queries/buildings";
import { getCatalogue, listEquipment } from "@/server/queries/capital-items";
import { listContacts } from "@/server/queries/contacts";
import { getRentRoll } from "@/server/queries/rent-periods";

/**
 * A building's page (`docs/ui/screens/building-detail.md`): its header, the
 * Summary's `Rent / mo` tile, the rent roll for the month in `?month=`, its
 * facts, its replacement runway, and its equipment, filtered by `?scope=` and
 * `?confidence=`. The recurring tasks come with the issue that stores them
 * (#113). The capital tiles and the runway read `src/lib/forecast/`, the
 * module the forecast page reads, so the two pages cannot disagree about a
 * year.
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

  // Everything on the list is in service; the forecast reads the same fields.
  const forecastItems: ForecastItem[] = equipment.map((item) => ({
    ...item,
    status: "active",
  }));
  const years = outflowByYear(replacements(forecastItems, thisYear), thisYear);
  // `CapEx through {next year}`: each item's own next replacement, past-due
  // ones included — not its recurrences, which the ten-year tile counts.
  const dueSoon = equipment.filter(
    (item) => replacementYear(item) <= thisYear + 1,
  );
  const pastLife = dueSoon.filter(
    (item) => lifeStatus(item, thisYear) === "past-life",
  ).length;

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
              <StatTile
                label={`CapEx through ${thisYear + 1}`}
                figure={
                  <Money
                    cents={dueSoon.reduce(
                      (sum, item) => sum + item.replacementCostCents,
                      0,
                    )}
                  />
                }
                sub={`${dueSoon.length === 1 ? "1 item" : `${dueSoon.length} items`}, ${pastLife} past life`}
                href="#equipment"
              />
              <StatTile
                label="Ten-year need / mo"
                figure={<Money cents={levelFundingPerMonthCents(years)} />}
                sub="to fund the next ten years evenly"
                // The forecast lists active buildings only, so an archived
                // or sold one's filter would open the whole portfolio.
                href={
                  editable ? `/forecast?building=${building.id}` : "#equipment"
                }
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

          {/* The spec puts the runway in the recurring tasks' rail. Until those
              are stored (#113) there is no band to put it beside, so it
              stands on its own where the band will be. */}
          <section
            aria-labelledby="runway-heading"
            className="overflow-hidden rounded-lg border border-border-card bg-surface-card"
          >
            <h2
              id="runway-heading"
              className="border-b border-border-divider px-5 py-4 text-md leading-tight font-semibold text-text-primary"
            >
              Replacement runway
            </h2>
            <RunwayList
              rows={years.slice(0, 5).map((bar) => ({
                year: bar.year,
                items: runwayItems(bar.replacements.map((r) => r.item.label)),
                cents: bar.totalCents,
                href: `/forecast?building=${building.id}&year=${bar.year}`,
              }))}
            />
          </section>

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
 * A runway year's items by name, largest first as the forecast sorts them:
 * `Furnace, Dishwasher ×2`. Null for a year with nothing due.
 */
function runwayItems(labels: readonly string[]): string | null {
  if (labels.length === 0) return null;

  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);

  return [...counts]
    .map(([label, count]) => (count === 1 ? label : `${label} ×${count}`))
    .join(", ");
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
