import Link from "next/link";
import type { ReactNode } from "react";

import { Meter } from "@/components/meter";
import { Money } from "@/components/money";
import { Numeric } from "@/components/numeric";
import { StatusBadge } from "@/components/status-badge";
import { buildingName, unitCount } from "@/lib/buildings";
import { cn } from "@/lib/cn";
import { type CalendarDate, formatDate } from "@/lib/dates";
import type { BuildingFlag } from "@/lib/forecast/building";
import type { Cents } from "@/lib/money";
import type { BuildingSummary } from "@/server/queries/buildings";

/** What an active building's card says about it, worked out by the page. */
export type BuildingCardFigures = {
  rent: {
    /** The current month where the building is. */
    month: CalendarDate;
    expectedCents: Cents;
    receivedCents: Cents;
  };
  /** The year where the building is — the card's `CapEx through` is the next. */
  thisYear: number;
  capexCents: Cents;
  /** Scheduled tasks overdue or due in the next 30 days. */
  tasksDue: number;
  flag: BuildingFlag;
  /** Systems life used, or null with no equipment in service. */
  lifeUsedPercent: number | null;
  /** Active items, and how many of their install years are estimated. */
  items: number;
  estimated: number;
};

/**
 * One building on the portfolio (`docs/ui/screens/portfolio.md`, Your
 * buildings). The whole card is one link to the building's page, and nothing
 * inside it is interactive — which is what makes a whole-card link legitimate.
 *
 * An active building's card carries its figures: the month's rent, CapEx
 * through next year, tasks due, the flag and systems life used. **An archived
 * or sold building's carries none** — the portfolio's figures leave it out, so
 * a `Tasks due` or a `Healthy` on it would be a figure nothing else on the
 * page counts. Its status is its flag, and the card is the way back to the
 * edit form that restores it.
 */
export function BuildingCard({
  building,
  figures,
}: {
  building: BuildingSummary;
  figures: BuildingCardFigures | null;
}) {
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
          <StatusBadge variant="neutral" className="shrink-0">
            {building.status === "sold" ? "Sold" : "Archived"}
          </StatusBadge>
        ) : figures && figures.items > 0 ? (
          <Flag flag={figures.flag} />
        ) : null}
      </div>

      {figures ? <Figures figures={figures} /> : null}
    </Link>
  );
}

/**
 * `portfolio.md`'s rule, first match wins, in words. **No flag at all on a
 * building with no equipment in service**: `Healthy` would be a verdict on
 * systems nobody has entered.
 */
function Flag({ flag }: { flag: BuildingFlag }) {
  const [variant, text] =
    flag.kind === "past-life"
      ? (["danger", `${flag.count} past life`] as const)
      : flag.kind === "due-soon"
        ? (["warning", `${flag.count} due soon`] as const)
        : flag.kind === "big-ticket"
          ? (["warning", `${flag.item.label} ${flag.year}`] as const)
          : (["good", "Healthy"] as const);

  return (
    <StatusBadge variant={variant} className="max-w-[45%] shrink-0 truncate">
      {text}
    </StatusBadge>
  );
}

function Figures({ figures }: { figures: BuildingCardFigures }) {
  const { rent, lifeUsedPercent } = figures;
  // `Sep`, from `Sep 2026`: the month is the current one, so its year is plain.
  const month = formatDate(rent.month, "month").split(" ")[0];

  return (
    <>
      <dl className="mt-auto grid grid-cols-3 gap-3 border-t border-border-divider pt-4">
        <Stat label={`Rent ${month}`}>
          {rent.expectedCents === 0 && rent.receivedCents === 0 ? (
            <span className="text-xs leading-snug text-text-muted">
              No rent expected
            </span>
          ) : (
            <>
              <Money cents={rent.receivedCents} />
              <span className="block pt-1 text-2xs leading-snug text-text-muted">
                {rent.receivedCents >= rent.expectedCents ? (
                  "received"
                ) : (
                  <>
                    of <Money cents={rent.expectedCents} />
                  </>
                )}
              </span>
            </>
          )}
        </Stat>
        <Stat label={`CapEx through ${figures.thisYear + 1}`}>
          <Money cents={figures.capexCents} />
        </Stat>
        <Stat label="Tasks due">
          <Numeric>{figures.tasksDue}</Numeric>
        </Stat>
      </dl>

      {lifeUsedPercent === null ? (
        <p className="text-xs leading-snug text-text-muted">No equipment yet</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="field-label">Systems life used</span>
            <Numeric className="text-xs text-text-secondary">
              {`${lifeUsedPercent}%`}
            </Numeric>
          </div>
          <Meter
            percent={lifeUsedPercent}
            fill={
              lifeUsedPercent >= 85
                ? "bg-meter-bad"
                : lifeUsedPercent >= 60
                  ? "bg-meter-warn"
                  : "bg-meter-good"
            }
          />
          {figures.estimated > 0 ? (
            <span className="text-2xs leading-snug text-text-muted">
              {`${figures.estimated} of ${figures.items} install years estimated`}
            </span>
          ) : null}
        </div>
      )}
    </>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <dt className="field-label">{label}</dt>
      <dd className="text-md leading-none text-text-primary">{children}</dd>
    </div>
  );
}
