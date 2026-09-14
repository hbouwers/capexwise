import Link from "next/link";

import { Money } from "@/components/money";
import { StatusBadge } from "@/components/status-badge";
import { buildingName, unitCount } from "@/lib/buildings";
import { cn } from "@/lib/cn";
import type { BuildingSummary } from "@/server/queries/buildings";

/**
 * One building on the portfolio (`docs/ui/screens/portfolio.md`, Your
 * buildings). The whole card is one link to the building's page, and nothing
 * inside it is interactive — which is what makes a whole-card link legitimate.
 *
 * **Built with what exists so far** (#105): the name, the meta line, and the
 * rent. The card's other two stats, its flag and its systems-life bar read
 * capital items and tasks, and arrive with them (#115). The stats are already
 * a three-column row so the ones still to come land beside this one rather
 * than reshaping the card.
 *
 * The rent is the current rent of the occupied units. The spec's "Rent {Mon}"
 * — received against expected for the month — needs rent periods (#108), and
 * a figure labelled as a month's takings that is really a rent roll would be
 * the number on the page that cannot be traced.
 */
export function BuildingCard({ building }: { building: BuildingSummary }) {
  const meta = [
    building.city,
    unitCount(building.unitCount),
    building.buildYear === null ? null : `built ${building.buildYear}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const inactive = building.status !== "active";

  return (
    <Link
      href={`/buildings/${building.id}`}
      className={cn(
        "flex h-full flex-col gap-4 rounded-lg border border-border-card bg-surface-card p-5 transition-colors hover:border-hover-border-card",
        inactive && "bg-surface-subtle",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="truncate text-md leading-tight font-semibold text-text-primary">
            {buildingName(building)}
          </h3>
          <p className="text-xs leading-snug text-text-muted">{meta}</p>
        </div>
        {inactive ? (
          <StatusBadge variant="neutral">
            {building.status === "sold" ? "Sold" : "Archived"}
          </StatusBadge>
        ) : null}
      </div>

      <dl className="mt-auto grid grid-cols-3 gap-3 border-t border-border-divider pt-4">
        <div className="flex flex-col gap-1.5">
          <dt className="field-label">Rent / mo</dt>
          <dd className="text-md leading-none text-text-primary">
            {building.occupiedCount === 0 ? (
              <span className="text-xs text-text-muted">No rent expected</span>
            ) : (
              <Money cents={building.rentCents} />
            )}
          </dd>
        </div>
      </dl>
    </Link>
  );
}
