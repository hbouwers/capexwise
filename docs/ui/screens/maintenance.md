# Maintenance

| | |
| --- | --- |
| Route | `/maintenance` |
| Release | v0 |
| PRD | F5 |
| Prototype | the `isTasks` block |

Every task across the portfolio: what is waiting for a date, what is booked, and what got done.

---

## Page header

| | |
| --- | --- |
| Title | `Maintenance` |
| Subtitle | `Scheduled and unscheduled work across the portfolio` — as built |
| Actions | A building `Select` (`All buildings`, then each), in `?building=`. `Add task` (primary), opening [the task modal](modal-task-detail.md) with `?task=new` |

With a building chosen, every figure and table on the page is that building's, and `Add task`
starts with it filled in.

---

## Layout

```
┌ StatTile × 4 ───────────────────────────────────────────────────────┐
├ Tabs: Unscheduled · 7   Scheduled · 8   Done ─────────────────────────┤
│ DataTable for the selected tab                                       │
└──────────────────────────────────────────────────────────────────────┘
```

One column. There is no rail, because every table here needs the width.

---

## Regions

### Tiles

| Tile | Figure | Sub-line | Links to |
| --- | --- | --- | --- |
| **Overdue** | Scheduled tasks past their date | `oldest {date}` | `?tab=scheduled` |
| **Next 30 days** | Scheduled tasks due in the next 30 days | `{cost} estimated` | `?tab=scheduled` |
| **Spent, last 12 months** | Actual cost of tasks completed in the last 12 months | `across {n} tasks` | `?tab=done` |
| **Done this year** | Tasks completed since January 1 | `{n} on time` | `?tab=done` |

Every tile keeps the page's building filter in its link.

**The Done tab is new, and the last two tiles are why.** The prototype's "Annual upkeep spend" and
"Completed YTD" count tasks that no list on the page shows, so neither figure could be traced. The
Done tab is that list.

**In v1, spend reads from expense entry.** A completed task's actual cost is recorded as an expense
([expenses.md](expenses.md)), and the Spent tile sums those expenses. Until then it sums the tasks'
`actual_cost_cents`. It has one source at a time, never both, or a task paid and entered twice would
count twice.

### Tabs

`Tabs` — Unscheduled, Scheduled and Done, the first two with their counts — in `?tab=`, defaulting
to Unscheduled. This is the `SegmentedControl` use that really is tabs
([components §7](../components.md)): it changes which table is shown and sets nothing.

### Unscheduled

Tasks with `status = 'unscheduled'`. High priority first, then oldest first.

| Column | Priority | Content |
| --- | --- | --- |
| Priority | `fold` | `PriorityPill` |
| Task | `primary` | Title, as a link to `?task={id}`; note line `added {date}` |
| Building | `fold` | Building name; `ScopeLabel` in the note line |
| Trade | `fold` | The task's trade |
| Est. cost | `figure` | `Money` |
| Assignee | `fold` | The contact's name, or `Unassigned` in `--text-muted` |

The whole row is the click target through the title link's stretched hit area, which keeps it one
`<a>` per row rather than a clickable `<tr>`.

### Scheduled

Tasks with `status = 'scheduled'`, in three `<tbody>` groups — **Overdue**, **Next 30 days** and
**Later** — each by date. The prototype groups the same way in its data and then flattens it on
screen; the groups are what make a list of dates scannable.

| Column | Priority | Content |
| --- | --- | --- |
| Done | `control` | `Checkbox` — completes the task, with Undo in a toast |
| Task | `primary` | Title as a link to `?task={id}` |
| Building | `fold` | Building name; `ScopeLabel` in the note line |
| Assignee | `fold` | Contact name |
| Repeats | `fold` | Frequency, or `Once` |
| Date | `figure` | `DateValue`, with `{n} days late` in `--status-danger` |
| Cost | `fold` | Estimated cost |
| Status | `fold` | `Confirmed` (good) or `Awaiting confirmation` (warning) |

Checking a task completes it on today's date at its cost estimate. A task that needs its real cost
or date recorded is completed from the task modal instead, which asks for both.

**`Status` needs a column nothing has yet.** PRD F5 has scheduled tasks carry a confirmation state,
and `tasks` has no field for it — a [gap](README.md#gaps-these-specs-found). Until it exists the
column is not rendered. The prototype's third state, "Rescheduled", is history rather than state and
is not carried forward.

### Done

Tasks with `status = 'done'`, most recently completed first, the last 12 months shown and
`Show earlier` beneath.

| Column | Priority | Content |
| --- | --- | --- |
| Task | `primary` | Title as a link to `?task={id}` |
| Building | `fold` | Building name; `ScopeLabel` in the note line |
| Assignee | `fold` | Contact name |
| Completed | `fold` | `DateValue`, and `{n} days late` if it was |
| Cost | `figure` | Actual cost, or `—` |

---

## Changes from the prototype

- **A Done tab**, and the two tiles that link to it — above.
- **No 90-day window on Scheduled.** An annual task's next occurrence can be eleven months out, and a
  list that hides it looks like the task was dropped.
- **"Click a row to schedule it, assign it, or request quotes" is gone.** Quote requests are v2, and
  a row that looks like a link does not need a sentence saying it is one.
- **`High / Normal / Low`**, the `task_priority` enum's words. The prototype's "Medium" named a value
  the schema calls `normal`, and a label that differs from its stored value is a translation someone
  eventually gets wrong. High takes the overdue pair; Normal and Low the neutral pair, told apart by
  their words ([components §9](../components.md), finding 3).
- **One trade per task.** The prototype gives tasks several; `tasks.trade_tag` holds one, and the
  trade exists to find contacts, where one is enough.

---

## Narrow viewports

- **Below `sm`** the tiles are rows, and the building `Select` moves under the page title with the
  `Add task` button beside it.
- The tab list is three tabs at every width; the counts drop below 360px.
- Scheduled keeps its three groups, so a phone still reads Overdue first.

---

## States

| State | What renders |
| --- | --- |
| **No tasks at all** | Tiles read zero, and the Unscheduled tab's `EmptyState`: `Nothing on the list` / `Add work that needs doing. Recurring jobs live on each building's page.` / `Add task` |
| **An empty tab** | Unscheduled: `Nothing waiting for a date.` Scheduled: `Nothing booked.` Done: `Nothing completed in the last 12 months.` — each one line, no action, since the other tabs have them |
| **Filtered to a building with nothing** | `No tasks at {building}` and `Show all buildings` |
| **Checkoff failed** | The box unchecks, and under the row: `Couldn't mark this done. Try again.` |
| **Loading** | Four tile skeletons, the tab list, eight row skeletons |
