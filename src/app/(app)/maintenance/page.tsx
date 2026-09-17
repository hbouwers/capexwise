import type { Metadata } from "next";
import Link from "next/link";

import { BuildingSelect } from "@/components/building-select";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { Numeric } from "@/components/numeric";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { StatTile, StatTiles } from "@/components/stat-tile";
import { AddTaskForm } from "@/components/tasks/add-task-form";
import { MaintenanceTabs } from "@/components/tasks/maintenance-tabs";
import {
  DoneTable,
  EmptyTab,
  ScheduledTable,
  type ScheduledGroups,
  TableFootLink,
  type TaskPlace,
  UnscheduledTable,
} from "@/components/tasks/task-tables";
import { Button } from "@/components/ui/button";
import { type CalendarDate, formatDate, todayIn } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import {
  inLastTwelveMonths,
  maintenanceFigures,
  maintenanceTab,
  scheduleGroup,
} from "@/lib/tasks";
import { getMaintenanceInputs } from "@/server/queries/tasks";

/**
 * Maintenance (`docs/ui/screens/maintenance.md`), PRD F5: every task across
 * the portfolio — what is waiting for a date, what is booked, and what got
 * done — or one building's, in `?building=`.
 *
 * **Every figure is counted from the rows on this page**, by the rules in
 * `src/lib/tasks.ts`, and each task against today where its own building is
 * (ADR-0005), so a tile always traces to a list somebody can read.
 */
export const metadata: Metadata = { title: "Maintenance — CapExWise" };

const TITLE = "Maintenance";
const SUBTITLE = "Scheduled and unscheduled work across the portfolio";

/** A search param as one string: the first, if it was given more than once. */
function param(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

export default async function MaintenancePage({
  searchParams,
}: PageProps<"/maintenance">) {
  const query = await searchParams;
  const inputs = await getMaintenanceInputs();

  const building =
    inputs.buildings.find((b) => b.id === param(query.building)) ?? null;
  const tab = maintenanceTab(param(query.tab));
  const allDone = param(query.done) === "all";

  // One `todayIn` per building, all from the same instant.
  const now = new Date();
  const places = new Map<string, TaskPlace>();
  const todays = new Map<string, CalendarDate>();
  for (const b of inputs.buildings) {
    todays.set(b.id, todayIn(b.timezone, now));
  }

  const tasks = inputs.tasks.filter(
    (task) => building === null || task.buildingId === building.id,
  );
  const buildingsById = new Map(inputs.buildings.map((b) => [b.id, b]));
  for (const task of tasks) {
    const owner = buildingsById.get(task.buildingId)!;
    places.set(task.id, {
      buildingName: owner.name,
      scope: owner.units.length > 1 ? (task.unitLabel ?? "Shared") : null,
      today: todays.get(owner.id)!,
    });
  }
  const todayOf = (task: { id: string }) => places.get(task.id)!.today;

  const figures = maintenanceFigures(
    tasks.map((task) => ({ ...task, today: todayOf(task) })),
  );

  /** This page, with the building kept and the rest as given. */
  const href = (params: Record<string, string>) => {
    const search = new URLSearchParams(params);
    if (building) search.set("building", building.id);
    const text = search.toString();
    return text ? `/maintenance?${text}` : "/maintenance";
  };

  const select =
    inputs.buildings.length > 1 ? (
      <BuildingSelect
        buildings={inputs.buildings.map(({ id, name }) => ({ id, name }))}
        selected={building?.id ?? null}
      />
    ) : null;

  const addForm = (
    <AddTaskForm
      // Remounted with the filter, so the building it starts with follows it.
      key={building?.id ?? "all"}
      mode="one-off"
      buildings={inputs.buildings}
      buildingId={building?.id ?? null}
    />
  );

  const header = (
    <PageHeader title={TITLE} subtitle={SUBTITLE} actions={select} />
  );

  if (inputs.buildings.length === 0) {
    return (
      <>
        {header}
        <PageBody>
          <EmptyState
            title="Nothing on the list"
            body="Tasks belong to a building. Add one, and its work is listed here."
            action={
              <Button asChild>
                <Link href="/buildings/new">Add a building</Link>
              </Button>
            }
          />
        </PageBody>
      </>
    );
  }

  const unscheduled = tasks.filter((task) => task.status === "unscheduled");
  const scheduled = tasks.filter((task) => task.status === "scheduled");
  const done = tasks.filter((task) => task.status === "done");

  const groups: ScheduledGroups = {
    overdue: [],
    nextThirtyDays: [],
    later: [],
  };
  for (const task of [...scheduled].sort(
    (a, b) =>
      a.dueDate!.localeCompare(b.dueDate!) || a.title.localeCompare(b.title),
  )) {
    const group = scheduleGroup(task.dueDate!, todayOf(task));
    if (group === "overdue") groups.overdue.push(task);
    else if (group === "next-30-days") groups.nextThirtyDays.push(task);
    else groups.later.push(task);
  }

  const recentDone = done.filter((task) =>
    inLastTwelveMonths(task.completedOn!, todayOf(task)),
  );
  const shownDone = allDone ? done : recentDone;
  const earlier = done.length - recentDone.length;

  const card = (children: React.ReactNode) => (
    <div className="overflow-hidden rounded-lg border border-border-card bg-surface-card">
      {children}
    </div>
  );

  const panels = {
    unscheduled: card(
      <>
        {unscheduled.length === 0 ? (
          <EmptyTab>Nothing waiting for a date.</EmptyTab>
        ) : (
          <UnscheduledTable tasks={unscheduled} places={places} />
        )}
        <div className="border-t border-border-divider">{addForm}</div>
      </>,
    ),
    scheduled: card(
      scheduled.length === 0 ? (
        <EmptyTab>Nothing booked.</EmptyTab>
      ) : (
        <ScheduledTable groups={groups} places={places} />
      ),
    ),
    done: card(
      shownDone.length === 0 ? (
        <>
          <EmptyTab>Nothing completed in the last 12 months.</EmptyTab>
          {earlier > 0 ? (
            <TableFootLink href={href({ tab: "done", done: "all" })}>
              Show earlier
            </TableFootLink>
          ) : null}
        </>
      ) : (
        <DoneTable
          tasks={shownDone}
          places={places}
          footer={
            allDone ? (
              earlier > 0 ? (
                <TableFootLink href={href({ tab: "done" })}>
                  Show the last 12 months
                </TableFootLink>
              ) : null
            ) : earlier > 0 ? (
              <TableFootLink href={href({ tab: "done", done: "all" })}>
                {`Show earlier (${earlier})`}
              </TableFootLink>
            ) : null
          }
        />
      ),
    ),
  };

  const tiles = (
    <StatTiles>
      <StatTile
        label="Overdue"
        figure={<Numeric>{figures.overdue.count}</Numeric>}
        sub={
          figures.overdue.oldest
            ? `oldest ${formatDate(figures.overdue.oldest, "short")}`
            : "nothing late"
        }
        href={href({ tab: "scheduled" })}
      />
      <StatTile
        label="Next 30 days"
        figure={<Numeric>{figures.nextThirtyDays.count}</Numeric>}
        sub={`${formatMoney(figures.nextThirtyDays.estimatedCents)} estimated`}
        href={href({ tab: "scheduled" })}
      />
      <StatTile
        label="Spent, last 12 months"
        figure={<Money cents={figures.spentLastTwelveMonths.cents} />}
        sub={`across ${
          figures.spentLastTwelveMonths.tasks === 1
            ? "1 task"
            : `${figures.spentLastTwelveMonths.tasks} tasks`
        }`}
        href={href({ tab: "done" })}
      />
      <StatTile
        label="Done this year"
        figure={<Numeric>{figures.doneThisYear.count}</Numeric>}
        sub={`${figures.doneThisYear.onTime} on time`}
        href={href({ tab: "done" })}
      />
    </StatTiles>
  );

  return (
    <>
      {header}
      <PageBody>
        <div className="flex flex-col gap-6">
          {tiles}

          {inputs.tasks.length === 0 ? (
            <EmptyCard
              title="Nothing on the list"
              body="Add work that needs doing. Recurring jobs live on each building’s page."
            >
              {addForm}
            </EmptyCard>
          ) : building !== null && tasks.length === 0 ? (
            <EmptyCard
              title={`No tasks at ${building.name}`}
              body="Nothing waiting, booked or done here. Add a job, or look across every building."
              after={
                <Button variant="outline" size="sm" asChild>
                  <Link href="/maintenance" scroll={false}>
                    Show all buildings
                  </Link>
                </Button>
              }
            >
              {addForm}
            </EmptyCard>
          ) : (
            <MaintenanceTabs
              tab={tab}
              counts={{
                unscheduled: unscheduled.length,
                scheduled: scheduled.length,
              }}
              panels={panels}
            />
          )}
        </div>
      </PageBody>
    </>
  );
}

/**
 * The page's empty states (`maintenance.md`, states): `EmptyState`'s title
 * and line, with the add row as the action — here the row *is* the action, and
 * a button that only moved the focus to it would be one more step.
 */
function EmptyCard({
  title,
  body,
  after,
  children,
}: {
  title: string;
  body: string;
  after?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border-card bg-surface-card">
      <div className="flex flex-col items-start gap-3 px-5 pt-8 sm:items-center sm:px-8 sm:pt-12 sm:text-center">
        <h2 className="text-md leading-tight font-semibold text-text-primary">
          {title}
        </h2>
        <p className="max-w-prose text-sm leading-normal text-text-tertiary">
          {body}
        </p>
        {after}
      </div>
      <div className="mx-auto max-w-3xl pb-4 sm:pb-8">{children}</div>
    </section>
  );
}
