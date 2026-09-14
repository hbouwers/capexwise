import Link from "next/link";

import { BuildingCard } from "@/components/buildings/building-card";
import { EmptyState } from "@/components/empty-state";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { unitCount } from "@/lib/buildings";
import { getOrgContext } from "@/server/org-context";
import { listBuildings } from "@/server/queries/buildings";

/**
 * The portfolio (`docs/ui/screens/portfolio.md`), with what exists so far: the
 * header and the building cards. The tiles and the rail read tasks, capital
 * items and rent periods, and the finished screen is #115's — built last
 * because it reads everything else. Until this page, nothing linked to a
 * building.
 *
 * In a route group of its own, `(portfolio)`, for one reason: a `loading.tsx`
 * beside a page is the fallback for every route beneath that segment, and at
 * the top of `(app)` that is every screen in the product. Here it is only this
 * one's.
 *
 * It calls `getOrgContext()` itself rather than trusting the layout's call —
 * the layout's comment says why — and names the org it is showing in the
 * subtitle.
 */
export default async function PortfolioPage() {
  const { org } = await getOrgContext();
  const buildings = await listBuildings();

  // The header's counts are the portfolio's: archived and sold buildings and
  // retired units are left out, as they are of every figure on this page.
  const active = buildings.filter((building) => building.status === "active");
  const inactive = buildings.filter((building) => building.status !== "active");
  const units = active.reduce((sum, building) => sum + building.unitCount, 0);

  const subtitle = [
    org.name,
    active.length === 1 ? "1 building" : `${active.length} buildings`,
    unitCount(units),
  ].join(" · ");

  const addBuilding = (
    <Button asChild>
      <Link href="/buildings/new">Add building</Link>
    </Button>
  );

  return (
    <>
      <PageHeader title="Portfolio" subtitle={subtitle} actions={addBuilding} />
      <PageBody>
        {buildings.length === 0 ? (
          <EmptyState
            title="Add your first building"
            body="Start with the address and its units. Equipment and tasks come after."
            action={addBuilding}
          />
        ) : (
          <div className="flex flex-col gap-10">
            <section
              id="buildings"
              aria-labelledby="buildings-heading"
              className="@container flex flex-col gap-4"
            >
              <h2
                id="buildings-heading"
                className="text-md leading-tight font-semibold text-text-primary"
              >
                Your buildings
              </h2>
              {active.length === 0 ? (
                <p className="text-sm leading-normal text-text-tertiary">
                  Every building is archived. Open one below to restore it, or
                  add a building.
                </p>
              ) : (
                <BuildingGrid buildings={active} />
              )}
            </section>

            {/* Archived and sold buildings stay reachable — a building's own
                edit form is where it is restored — but apart from the ones
                the portfolio's figures count. */}
            {inactive.length > 0 ? (
              <section
                aria-labelledby="inactive-heading"
                className="@container flex flex-col gap-4"
              >
                <h2
                  id="inactive-heading"
                  className="text-md leading-tight font-semibold text-text-primary"
                >
                  {inactive.some((building) => building.status === "sold")
                    ? "Archived and sold"
                    : "Archived"}
                </h2>
                <BuildingGrid buildings={inactive} />
              </section>
            ) : null}
          </div>
        )}
      </PageBody>
    </>
  );
}

/**
 * One column, and two once the column is 36rem wide — a container query rather
 * than a viewport breakpoint, so the grid answers to the width it actually
 * has when the rail arrives beside it (`docs/ui/screens/README.md`, widths).
 */
function BuildingGrid({
  buildings,
}: {
  buildings: Awaited<ReturnType<typeof listBuildings>>;
}) {
  return (
    <ul className="grid gap-4 @xl:grid-cols-2">
      {buildings.map((building) => (
        <li key={building.id}>
          <BuildingCard building={building} />
        </li>
      ))}
    </ul>
  );
}
