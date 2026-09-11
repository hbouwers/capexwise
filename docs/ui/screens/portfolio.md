# Portfolio

| | |
| --- | --- |
| Route | `/` |
| Release | v0. The tax tile arrives with F4 and the cash flow tile becomes cash flow with expense entry, both v1 |
| PRD | F0, and F1's building cards |
| Prototype | the `isPortfolio` block — "Properties" in its rail |

The landing screen, and what the product is opened for: what needs doing, what is wearing out, and
where the money stands, across every building, with each figure one click from where it came from.

---

## Page header

| | |
| --- | --- |
| Title | `Portfolio` |
| Subtitle | `{org name} · {n} buildings · {n} units` — `Reyes Rentals · 2 buildings · 4 units` |
| Actions | `Add building` (primary), to [`/buildings/new`](building-form.md) |

The counts exclude archived and sold buildings and retired units. The prototype's `Export` action
waits for [#45](https://github.com/hbouwers/capexwise/issues/45), and its `Add equipment` action
needs a building to add to, so it lives on the building's page.

---

## Layout

```
┌ StatTile × 5 (4 in v0) ─────────────────────────────────────────────┐
├ Your buildings ─────────────────────────────┬ rail (336px) ──────────┤
│ BuildingCard grid                           │ Replacement runway     │
│                                             │ Due in the next 30 days│
└─────────────────────────────────────────────┴────────────────────────┘
```

A tile row, full width, then `grid-two-column`: the building cards in the main column, two cards in
the rail.

---

## Regions

### Tiles

PRD F0's five, in this order. Every tile is a link to the URL named in its row
([README](README.md#what-the-url-holds)), and the whole tile is the link.

| Tile | Figure | Sub-line | Links to |
| --- | --- | --- | --- |
| **Open tasks** | Unscheduled tasks | `{n} high priority` | `/maintenance` |
| **Upcoming tasks** | Scheduled tasks due in the next 30 days; when any are overdue, the split value `{n} overdue` in `--status-overdue` beside it | `Scheduled, next 30 days` | `/maintenance?tab=scheduled` |
| **End of life** | Active capital items at or past expected life | `{a} audited · {e} estimated` | `/forecast?year={this year}` |
| **Est. {year} tax** | F4's current-year liability | `{rate}% blended · estimate` | `/tax` |
| **Rent received** / **Cash flow** | See below | See below | See below |

**End of life links to the forecast's current year** because that bar is the same set: the
forecast rolls every replacement already past due into this year, so the items behind the tile are
the items listed under this year's bar. The sub-line is PRD F0's "flagged as estimates rather than
mixed in silently".

**The tax tile is absent in v0**, not a placeholder. Four tiles lay out on the same `auto-fit` grid.
When F4 ships, the tile carries `TaxDisclaimer`'s compact form below the sub-line — the same
disclaimer the page carries, per F0.

**The fifth tile is named for what it can prove.** In v0 there is no money out, so the tile is
**Rent received**: the figure is rent received this month, the sub-line is
`of {expected} expected · {received YTD} this year`, and it links to `#buildings` — the card grid
below, where each card shows its own building's received-of-expected and links to that building's
rent roll. Two clicks from the tile to the rent period that produced the number. With expense entry
in v1 it becomes **Cash flow** — received less recorded spend, month to date, year to date in the
sub-line — and links to [`/expenses`](expenses.md) for the month, which is the screen that shows
both sides.

Calling the v0 figure "cash flow" would put a number labelled net on a page that only knows gross.

### Your buildings

`id="buildings"`, a section heading `Your buildings`, and a grid of `BuildingCard`. One column, and
two when the column is at least 36rem wide (`@xl:grid-cols-2` on an `@container` main column — see
[README](README.md#widths) for why it is not a viewport breakpoint). Sorted by label, then address.

Each card is one `<a>` to `/buildings/{id}` — there is nothing else interactive inside it, which is
what makes a whole-card link legitimate.

| Part | Content |
| --- | --- |
| Name | `label`, falling back to `address_line1` |
| Meta | `{city} · {n} units · built {build_year}` — the year in the sentence's font |
| Flag | `StatusBadge`, by the rule below |
| Stat 1 | **Rent {Mon}** — `$3,150 of $4,600`, or `$4,600` with a `received` note when it is all in. A vacant building reads `No rent expected` |
| Stat 2 | **CapEx through {next year}** — replacement cost of active items whose replacement year is next year or earlier |
| Stat 3 | **Tasks due** — scheduled tasks overdue or due in the next 30 days |
| Footer | `LifeBar`: **Systems life used**, with the percentage in text, and `{e} of {n} install years estimated` beneath it when any are |

**The flag rule**, which [components §7](../components.md) left as a proposal and this settles, first
match wins:

1. Any active item past life → `{n} past life`, danger
2. Any active item at 85% of life or more → `{n} due soon`, warning
3. A big-ticket replacement in the next three years → `{item} {year}`, warning
4. Otherwise → `Healthy`, good

**Big ticket** is a replacement cost of $5,000 or more. That is a forecast-module constant,
proposed here because the prototype has no consistent one — it tags a $6,800 furnace big-ticket and
a $6,900 exterior paint job not — and the flag cannot be tested without one.

**Systems life used** is the replacement-cost-weighted mean of each active item's age over its
expected life, each item capped at 100%. Weighted by cost, because a roof at 90% matters more than
a microwave at 90%; capped, because one item forty years past life should not read as a building
at 300%. Forecast-module logic, proposed here for the same reason.

**"CapEx through {next year}" replaces the prototype's "CapEx 12mo"** because the data cannot
answer the prototype's question. A replacement year is a year, not a date, so there is no set of
items that falls in "the next twelve months" — the prototype's own code sums items due by next
year and labels it twelve months. The label now states the boundary the sum actually uses.

**No photo in v0.** File storage is [#40](https://github.com/hbouwers/capexwise/issues/40), v1. The
card starts at its name; there is no grey placeholder box, which on every card would be the most
visible thing on the page and say nothing. When #40 ships the photo is optional, and a card without
one keeps this layout.

### Replacement runway

A `Card` with a `RunwayList` of the next five calendar years, starting this year: year, a `Meter`
scaled to the largest of the five, and the year's total in compact `Money`. Each row is a link to
`/forecast?year={year}`, and a footer link `Open the forecast` goes to `/forecast`.

The prototype titles this "Big-ticket runway" and sums every replacement in the year, big-ticket or
not. The sum is the useful number, so the title changes to match it — and matches the building
page's runway, which is the same component at a different scope.

### Due in the next 30 days

A `Card` listing scheduled tasks that are overdue or due within 30 days, overdue first, then by date,
at most six. Each row is a link to `?task={id}`, opening [the task modal](modal-task-detail.md) over
this page: a status dot, the task's title, and a note line of
`{building} · {date}` plus `{n} days late` when it is. The heading's `All` link goes to
`/maintenance?tab=scheduled`.

The prototype calls this "Due this month" and draws it from a different window than its tasks tile.
It is the same window as the Upcoming tasks tile now, so the list is the tile's contents rather than
a second definition of "soon".

---

## Changes from the prototype

- **The tiles are F0's, not the prototype's.** The prototype's five are gross rent, CapEx 12 months,
  reserve balance, estimated tax and tasks due. F0 names open tasks, upcoming tasks, end-of-life
  warnings, estimated tax and cash flow, and [#12](https://github.com/hbouwers/capexwise/issues/12)
  says F0 wins. Gross rent survives on the cards; the reserve moves to the forecast, which owns it.
- **"Properties" is "Portfolio"** in the title, and "Your properties" is "Your buildings"
  ([components §2](../components.md)).
- **"Click a card to open the property" is gone.** A card that is a link does not need a caption
  saying so, and the caption is the only text in the prototype addressed to someone who cannot tell
  what a card is.
- **The date stamp and `Export` are gone** from the header — see the [README](README.md#dates) and
  above.

---

## Narrow viewports

- **Below `lg`** the rail's two cards follow the building cards, runway first.
- **Below `sm`** tiles are rows ([README](README.md#stat-tiles)), and a building card's three stats
  stay three across — they are short figures, and a card that stacks them is taller than the screen.
- The subtitle truncates before the header wraps; the counts it carries are also on the tiles and
  the cards.

---

## States

| State | What renders |
| --- | --- |
| **No buildings** | No tiles and no rail — every figure on them would be zero, and a row of zeros reads as a report. In their place, one `EmptyState`: `Add your first building` / `Start with the address and its units. Equipment and tasks come after.` / `Add building` |
| **Buildings, no capital items** | Tiles render; End of life reads `0` with the sub-line `No equipment recorded yet`, and each card's life bar is replaced by `No equipment yet`. The runway card's `EmptyState`: `No replacements to forecast` / `Add equipment to a building and its replacements appear here.` |
| **Nothing due in 30 days** | The list reads `Nothing scheduled in the next 30 days`, with the `All` link kept |
| **Loading** | Four or five tile skeletons, two card skeletons, two rail card skeletons |
