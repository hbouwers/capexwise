import Link from "next/link";

import {
  BuildingCard,
  type BuildingCardFigures,
} from "@/components/buildings/building-card";
import { DateValue } from "@/components/date-value";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { Numeric } from "@/components/numeric";
import { RunwayList } from "@/components/runway-list";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { StatTile, StatTiles } from "@/components/stat-tile";
import { TaskDetailModal } from "@/components/tasks/task-detail-modal";
import { TaskNotFound } from "@/components/tasks/task-not-found";
import { Button } from "@/components/ui/button";
import { unitCount } from "@/lib/buildings";
import { cn } from "@/lib/cn";
import { type CalendarDate, shortFormIn, todayIn, yearOf } from "@/lib/dates";
import {
  buildingFlag,
  capexThroughNextYear,
  endOfLife,
  systemsLifeUsedPercent,
} from "@/lib/forecast/building";
import { outflowByYear, replacements } from "@/lib/forecast/outflow";
import { forecastHref, forecastToday } from "@/lib/forecast/params";
import { formatMoney } from "@/lib/money";
import {
  DUE_LIST_LIMIT,
  dueInNextThirtyDays,
  taskTiles,
} from "@/lib/portfolio";
import { dueNote, dueNoteText, scheduleGroup, taskHref } from "@/lib/tasks";
import { getOrgContext } from "@/server/org-context";
import { listBuildings } from "@/server/queries/buildings";
import { getForecastInputs } from "@/server/queries/forecast";
import { getPortfolioRent } from "@/server/queries/rent-periods";
import { getMaintenanceInputs, getTaskModal } from "@/server/queries/tasks";

/**
 * The portfolio (`docs/ui/screens/portfolio.md`), PRD F0: what needs doing,
 * what is wearing out and where the rent stands, across every active
 * building, each figure one click from the surface that owns it. `?task=`
 * opens the task modal over it, from `Due in the next 30 days`.
 *
 * **Every figure is read through the rule its own surface uses** — the task
 * tiles through `src/lib/portfolio.ts`'s one window, the equipment through
 * `src/lib/forecast/`, the rent through `rentTotals` — so a tile cannot
 * disagree with the page it links to. Each task and each building's rent is
 * judged by today where its building is (ADR-0005). The End of life tile and
 * the runway use the forecast's own day, the latest of the buildings', so they
 * match the forecast page they link to; a card uses its building's, so it
 * matches the building's page.
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
export default async function PortfolioPage({ searchParams }: PageProps<"/">) {
  const query = await searchParams;
  const taskParam = Array.isArray(query.task)
    ? (query.task[0] ?? null)
    : (query.task ?? null);

  const { org } = await getOrgContext();
  const [buildings, rent, forecastInputs, maintenance, modal] =
    await Promise.all([
      listBuildings(),
      getPortfolioRent(),
      getForecastInputs(),
      getMaintenanceInputs(),
      getTaskModal(taskParam, null),
    ]);

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

  // One instant for every building's day.
  const now = new Date();
  const todays = new Map<string, CalendarDate>(
    active.map((building) => [building.id, todayIn(building.timezone, now)]),
  );

  const tasks = maintenance.tasks.map((task) => ({
    ...task,
    today: todays.get(task.buildingId) ?? todayIn("UTC", now),
  }));
  const tiles = taskTiles(tasks);
  const due = dueInNextThirtyDays(tasks);

  const items = forecastInputs.items;
  const forecastDay = forecastToday(
    forecastInputs.buildings.map((building) => building.timezone),
    now,
  );
  const thisYear = yearOf(forecastDay);
  const lifeEnd = endOfLife(items, thisYear);
  const runway = outflowByYear(replacements(items, thisYear), thisYear).slice(
    0,
    5,
  );

  const rentTotal = { expected: 0, received: 0, thisYear: 0 };
  for (const building of rent.values()) {
    rentTotal.expected += building.expectedCents;
    rentTotal.received += building.receivedCents;
    rentTotal.thisYear += building.receivedThisYearCents;
  }

  const figuresFor = (buildingId: string): BuildingCardFigures | null => {
    const today = todays.get(buildingId);
    const buildingRent = rent.get(buildingId);
    if (!today || !buildingRent) return null;

    const year = yearOf(today);
    const own = items.filter((item) => item.buildingId === buildingId);

    return {
      rent: buildingRent,
      thisYear: year,
      capexCents: capexThroughNextYear(own, year).cents,
      tasksDue: due.filter((task) => task.buildingId === buildingId).length,
      flag: buildingFlag(own, year),
      lifeUsedPercent: systemsLifeUsedPercent(own, year),
      items: own.length,
      estimated: own.filter((item) => item.confidence === "estimated").length,
    };
  };

  const buildingsById = new Map(
    maintenance.buildings.map((building) => [building.id, building]),
  );

  const taskModal =
    modal && modal.kind !== "not-found" ? (
      <TaskDetailModal
        // A fresh modal per task, so nothing typed for one carries over.
        key={taskParam}
        modal={modal}
        today={todayIn(
          modal.kind === "edit"
            ? modal.building.timezone
            : modal.buildings[0]!.timezone,
          now,
        )}
        closeHref={taskHref("/", query, null)}
      />
    ) : null;
  const taskNotFound = modal?.kind === "not-found" ? <TaskNotFound /> : null;

  return (
    <>
      <PageHeader title="Portfolio" subtitle={subtitle} actions={addBuilding} />
      <PageBody>
        {buildings.length === 0 ? (
          <div className="flex flex-col gap-6">
            {taskNotFound}
            <EmptyState
              title="Add your first building"
              body="Start with the address and its units. Equipment and tasks come after."
              action={addBuilding}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {taskNotFound}

            {/* No tiles without an active building: every one would be zero,
                and a row of zeros reads as a report. */}
            {active.length > 0 ? (
              <StatTiles>
                <StatTile
                  label="Open tasks"
                  figure={<Numeric>{tiles.open.count}</Numeric>}
                  sub={`${tiles.open.highPriority} high priority`}
                  href="/maintenance"
                />
                <StatTile
                  label="Upcoming tasks"
                  figure={
                    <span className="flex items-baseline gap-2.5">
                      <Numeric>{tiles.upcoming.count}</Numeric>
                      {tiles.upcoming.overdue > 0 ? (
                        <Numeric className="text-sm text-status-overdue">
                          {`${tiles.upcoming.overdue} overdue`}
                        </Numeric>
                      ) : null}
                    </span>
                  }
                  sub="Scheduled, next 30 days"
                  href="/maintenance?tab=scheduled"
                />
                <StatTile
                  label="End of life"
                  figure={
                    <Numeric>{lifeEnd.audited + lifeEnd.estimated}</Numeric>
                  }
                  sub={
                    items.length === 0
                      ? "No equipment recorded yet"
                      : `${lifeEnd.audited} audited · ${lifeEnd.estimated} estimated`
                  }
                  // This year's bar is the same set: the forecast folds every
                  // past-due replacement into it.
                  href={forecastHref({ year: thisYear })}
                />
                <StatTile
                  label="Rent received"
                  figure={<Money cents={rentTotal.received} />}
                  sub={`of ${formatMoney(rentTotal.expected)} expected · ${formatMoney(rentTotal.thisYear)} this year`}
                  href="#buildings"
                />
              </StatTiles>
            ) : null}

            <div
              className={
                active.length > 0
                  ? "grid-two-column items-start"
                  : "flex flex-col"
              }
            >
              <div className="flex min-w-0 flex-col gap-10">
                <section
                  id="buildings"
                  aria-labelledby="buildings-heading"
                  className="@container flex scroll-mt-24 flex-col gap-4"
                >
                  <h2
                    id="buildings-heading"
                    className="text-md leading-tight font-semibold text-text-primary"
                  >
                    Your buildings
                  </h2>
                  {active.length === 0 ? (
                    <p className="text-sm leading-normal text-text-tertiary">
                      {inactive.some(
                        (building) => building.status === "archived",
                      )
                        ? "None is in the portfolio right now. Open an archived one below to restore it, or add a building."
                        : "None is in the portfolio right now. Add a building to start it again."}
                    </p>
                  ) : (
                    <ul className="grid gap-4 @xl:grid-cols-2">
                      {active.map((building) => (
                        <li key={building.id}>
                          <BuildingCard
                            building={building}
                            figures={figuresFor(building.id)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {/* Archived and sold buildings stay reachable — a building's
                    own edit form is where it is restored — but apart from the
                    ones the portfolio's figures count. */}
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
                    <ul className="grid gap-4 @xl:grid-cols-2">
                      {inactive.map((building) => (
                        <li key={building.id}>
                          <BuildingCard building={building} figures={null} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>

              {/* The rail, which follows the building cards below `lg`,
                  runway first. */}
              {active.length > 0 ? (
                <div className="flex flex-col gap-5">
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
                    {items.length === 0 ? (
                      <RailEmpty
                        title="No replacements to forecast"
                        body="Add equipment to a building and its replacements appear here."
                      />
                    ) : (
                      <>
                        <RunwayList
                          meter
                          rows={runway.map((bar) => ({
                            year: bar.year,
                            cents: bar.totalCents,
                            href: forecastHref({ year: bar.year }),
                          }))}
                        />
                        <RailFootLink href="/forecast">
                          Open the forecast
                        </RailFootLink>
                      </>
                    )}
                  </section>

                  <section
                    aria-labelledby="due-heading"
                    className="overflow-hidden rounded-lg border border-border-card bg-surface-card"
                  >
                    <div className="flex items-baseline justify-between gap-3 border-b border-border-divider px-5 py-4">
                      <h2
                        id="due-heading"
                        className="text-md leading-tight font-semibold text-text-primary"
                      >
                        Due in the next 30 days
                      </h2>
                      <Link
                        href="/maintenance?tab=scheduled"
                        className="text-xs text-text-tertiary underline-offset-4 hover:text-text-primary hover:underline"
                      >
                        All
                        <span className="sr-only"> scheduled tasks</span>
                      </Link>
                    </div>
                    {due.length === 0 ? (
                      <p className="px-5 py-4 text-sm leading-normal text-text-muted">
                        Nothing scheduled in the next 30 days
                      </p>
                    ) : (
                      <ul className="flex flex-col">
                        {due.slice(0, DUE_LIST_LIMIT).map((task) => {
                          const building = buildingsById.get(task.buildingId);
                          const late =
                            scheduleGroup(task.dueDate!, task.today) ===
                            "overdue";
                          const note = dueNote(task.dueDate!, task.today, 0);
                          const scope =
                            building && building.units.length > 1
                              ? (task.unitLabel ?? "Shared")
                              : null;

                          return (
                            <li
                              key={task.id}
                              className="border-b border-border-divider last:border-b-0"
                            >
                              <Link
                                href={taskHref("/", query, task.id)}
                                scroll={false}
                                className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-hover-fill-subtle"
                              >
                                <span
                                  aria-hidden
                                  className={cn(
                                    "mt-1.5 size-2 shrink-0 rounded-full",
                                    late
                                      ? "bg-status-overdue"
                                      : "bg-status-warning",
                                  )}
                                />
                                <span className="flex min-w-0 flex-col gap-1">
                                  <span className="truncate text-sm text-text-primary">
                                    {task.title}
                                  </span>
                                  <span className="text-xs leading-snug text-text-muted">
                                    {[building?.name, scope]
                                      .filter(Boolean)
                                      .join(" · ")}
                                    {" · "}
                                    <DateValue
                                      date={task.dueDate!}
                                      form={shortFormIn(
                                        task.dueDate!,
                                        task.today,
                                      )}
                                    />
                                    {note?.kind === "late" ? (
                                      <span className="text-status-danger">
                                        {` · ${dueNoteText(note)}`}
                                      </span>
                                    ) : null}
                                  </span>
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                </div>
              ) : null}
            </div>
          </div>
        )}
        {taskModal}
      </PageBody>
    </>
  );
}

/** A rail card's empty state: `EmptyState`'s title and line, inside the card. */
function RailEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-1.5 px-5 py-4">
      <p className="text-sm font-medium text-text-primary">{title}</p>
      <p className="text-xs leading-normal text-text-tertiary">{body}</p>
    </div>
  );
}

function RailFootLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="block border-t border-border-divider px-5 py-3 text-xs text-text-tertiary underline-offset-4 hover:text-text-primary hover:underline"
    >
      {children}
    </Link>
  );
}
