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
| Assignee | `fold` | The contact's name, `Me` for a task assigned to the viewer, `A member` for another member's until #30 names them, or `Unassigned` in `--text-muted` |

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
| Assignee | `fold` | As on Unscheduled |
| Repeats | `fold` | Frequency, or `Once` |
| Date | `figure` | `DateValue`, with `{n} days late` in `--status-danger` |
| Cost | `fold` | Estimated cost |
| Status | `fold` | `Confirmed` (good) or `Awaiting confirmation` (warning), as a toggle. Nothing for an unassigned task |

Checking a task completes it on today's date at its cost estimate. A task that needs its real cost
or date recorded is completed from the task modal instead, which asks for both.

**`Status` is `tasks.confirmed_on`** ([data-model §6](../../data-model.md), #93): the day the work was
booked with its assignee. The cell is a toggle — `Awaiting confirmation` records today, in the
building's zone, and `Confirmed` clears it — with Undo in a toast, the shared rule for one-click
writes. Its accessible name carries the task's title, because a column of them read out of the
table all say the same word. An unassigned task has nobody to confirm with and shows nothing
there. Changing a task's date or assignee clears its confirmation, in the database. The prototype's
third state, "Rescheduled", is history rather than state and is not carried forward.

### Done

Tasks with `status = 'done'`, most recently completed first, the last 12 months shown and
`Show earlier` beneath.

| Column | Priority | Content |
| --- | --- | --- |
| Task | `primary` | Title as a link to `?task={id}` |
| Building | `fold` | Building name; `ScopeLabel` in the note line |
| Assignee | `fold` | As on Unscheduled |
| Completed | `fold` | `DateValue`, and `{n} days late` if it was |
| Cost | `figure` | Actual cost, or `—` |

---

## As built

#113 built this screen before the task modal, and #114 added the modal. What they settled that the
regions above do not say:

- **`Add task` and every task's title open the task modal**, over the tab and the building filter
  they were opened from. The inline add row #113 closed the Unscheduled tab with, until the modal
  existed, is gone. The two empty states take `Add task` as their action, and the filtered one has
  `Show all buildings` beside it.
- **Only active buildings' tasks are shown**, and the building `Select` lists only active
  buildings, as the forecast's does. An archived or sold building is kept for its history and left
  out of the portfolio's figures; its recurring tasks stay readable on its own page.
- **The Status toggle is a `<button aria-pressed>` in the badge's colours**, rather than a
  `StatusBadge` beside a separate control, so the column stays one word per row. It renders only on
  a task with an assignee.
- **From `md` to `xl` a few columns fold as well** — Trade on Unscheduled; Assignee, Repeats and
  Cost on Scheduled; Assignee on Done — into the note line, as text. With the rail open, seven
  fixed columns left the task's name a sliver at 1024px.
- **A date outside this year carries its year** — `May 15, 2027` — and one inside it does not. An
  annual job's next occurrence is next year's, and `Sep 16` read as this month.
- **`Show earlier` is `?done=all`**, with `Show the last 12 months` to go back. The window is each
  task's own building's twelve months, as every figure here is.
- **A tile's sub-line has a word when its figure is zero**: `nothing late` rather than an `oldest`
  with no date.

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
