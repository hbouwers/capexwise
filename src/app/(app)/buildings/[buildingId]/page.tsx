import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BuildingFactsCard } from "@/components/buildings/building-facts-card";
import { Money } from "@/components/money";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { StatTile, StatTiles } from "@/components/stat-tile";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  buildingName,
  cityLine,
  fullAddress,
  unitCount,
} from "@/lib/buildings";
import { formatDate } from "@/lib/dates";
import { getBuildingFacts } from "@/server/queries/building-facts";
import { getBuilding, type UnitRecord } from "@/server/queries/buildings";
import { listContacts } from "@/server/queries/contacts";

/**
 * A building's page (`docs/ui/screens/building-detail.md`): its header, the
 * Summary's `Rent / mo` tile, its units, and its facts. The other regions — the
 * rent roll's checkoff, recurring tasks, equipment — each come with the issue
 * that stores what they show, and the page grows downward as they do.
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
}: PageProps<"/buildings/[buildingId]">) {
  const detail = await getBuilding((await params).buildingId);
  if (!detail) notFound();

  const { building } = detail;
  const [facts, contacts] = await Promise.all([
    getBuildingFacts(building.id),
    listContacts(),
  ]);
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
          <Button variant="outline" asChild>
            <Link href={`/buildings/${building.id}/edit`}>Edit building</Link>
          </Button>
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

          <UnitsCard units={units} rentCents={rentCents} />

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
        </div>
      </PageBody>
    </>
  );
}

/**
 * The units, and what each is let for. The rent roll's month switcher and
 * Paid checkoff take this card's place with rent periods (#108); until then it
 * is the current rent of each unit, which is what a new month will expect.
 *
 * Two columns with their `docs/ui/screens/README.md` priorities: the unit is
 * `primary` and the rent `figure`, so the table is the same table at every
 * width, and a vacant unit's row says so in words rather than with a blank.
 */
function UnitsCard({
  units,
  rentCents,
}: {
  units: UnitRecord[];
  rentCents: number;
}) {
  return (
    <section
      id="units"
      aria-labelledby="units-heading"
      className="scroll-mt-6 overflow-hidden rounded-lg border border-border-card bg-surface-card lg:scroll-mt-20"
    >
      <h2
        id="units-heading"
        className="border-b border-border-divider px-5 py-4 text-md leading-tight font-semibold text-text-primary"
      >
        Units &amp; rent
      </h2>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-5">
              <span className="field-label">Unit</span>
            </TableHead>
            <TableHead className="w-36 pr-5 text-right">
              <span className="field-label">Rent / mo</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {units.map((unit) => {
            const note =
              unit.status === "vacant"
                ? "No rent expected"
                : unit.leaseEnd
                  ? `Lease ends ${formatDate(unit.leaseEnd, "month")}`
                  : null;

            return (
              <TableRow
                key={unit.id}
                className="border-border-divider hover:bg-hover-fill-subtle"
              >
                <TableCell className="pl-5 whitespace-normal">
                  <span className="block truncate text-sm font-medium text-text-primary">
                    {unit.label}
                  </span>
                  {note ? (
                    <span className="block text-2xs leading-snug text-text-muted">
                      {note}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="pr-5 text-right">
                  {unit.status === "vacant" ? (
                    <span className="text-sm text-text-muted">Vacant</span>
                  ) : unit.rentCents === null ? (
                    // The form requires an occupied unit's rent; a row written
                    // any other way still says what it is, not "Vacant".
                    <span className="text-sm text-text-muted">Not entered</span>
                  ) : (
                    <Money cents={unit.rentCents} />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        <TableFooter className="bg-surface-subtle">
          <TableRow className="hover:bg-transparent">
            <TableCell className="pl-5 text-sm font-medium text-text-secondary">
              Occupied units
            </TableCell>
            <TableCell className="pr-5 text-right font-medium">
              <Money cents={rentCents} />
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </section>
  );
}
