# Screen specs

**Status:** v1 — the per-screen contract to build against
**Source:** `docs/ui/reference/rental-manager.html`, read 2026-09-10, with
[`tokens.md`](../tokens.md), [`components.md`](../components.md) and [`PRD.md`](../../PRD.md)
**Issue:** [#12](https://github.com/hbouwers/capexwise/issues/12)

Third of the three UI handoff documents. [`tokens.md`](../tokens.md) settled the values and
[`components.md`](../components.md) the names; these settle **which components each screen uses, in
what order, with what strings, and what happens to each on a narrow viewport.** A spec names a
token or a component and does not restate it. Where a spec and the prototype disagree, the spec
wins, and it says why.

The prototype's data is Somerville, MA; the examples here keep its figures so they can be checked
against it, but the demo city is Indianapolis ([#34](https://github.com/hbouwers/capexwise/issues/34)).

---

## Index

| Spec | Route | Release | PRD |
| --- | --- | --- | --- |
| [Portfolio](portfolio.md) | `/` | v0 | F0, F1 |
| [Building detail](building-detail.md) | `/buildings/[buildingId]` | v0 | F1, F2, F5 |
| [Building form](building-form.md) | `/buildings/new`, `/buildings/[buildingId]/edit` | v0 | F1 |
| [Maintenance](maintenance.md) | `/maintenance` | v0 | F5 |
| [Contact book](contacts.md) | `/contacts` | v0 | F6 |
| [CapEx forecast](capex-forecast.md) | `/forecast` | v0 | F3 |
| [Tax planner](tax-planner.md) | `/tax` | v1; its advisor v2 | F4, F8 |
| [Expenses](expenses.md) | `/expenses` | v1 | §12 Q5 |
| [Add equipment](modal-add-equipment.md) | modal, on a building's page | v0 | F2 |
| [Task detail](modal-task-detail.md) | modal, `?task=` | v0 | F5 |
| [Quote request](modal-quote-request.md) | inside the task modal | v2 | F7 |

The six screens and three modals are the ones the prototype draws. **The building form and
expenses are not in it**: v0 cannot enter a building without the first, and PRD §12 put the second
in v1 knowing the prototype never drew it.

A spec's release is the release its feature ships in, and a figure that depends on a later
feature says so rather than rendering a placeholder for it.

---

## How a spec is laid out

Every screen spec has these sections, so a missing one is visible. A modal's spec swaps the second
to fourth for its header, body and footer, and a spec with nothing in the prototype behind it has no
fifth:

1. **The table at the top** — route, release, feature area, and the prototype block it came from.
2. **Page header** — the title, the subtitle, and the actions, as `PageHeader` takes them.
3. **Layout** — the regions in order at full width, each with its components.
4. **Regions** — per region: what it shows, where each figure comes from, what each control does.
5. **Changes from the prototype** — what does not carry forward, with the reason.
6. **Narrow viewports** — what changes below each breakpoint, beyond the shared rules below.
7. **States** — empty, empty-because-filtered, loading, and the errors particular to the screen.

---

## Rules every screen shares

These apply to every spec, and a spec only mentions them where it departs from them.

### Widths

The prototype sets `min-width: 1240px` on the content column. Nothing replaces it: the product is
**usable down to 320px**, the narrowest viewport in current use, and every spec is written against
that floor.

| Width | What changes | Where it is decided |
| --- | --- | --- |
| `lg` and up (≥1024px) | The rail is fixed; two-column screens show their rail column | The shell, [components §4](../components.md) |
| Below `lg` | The rail is a drawer; two-column screens become one column, rail content after the main column unless a spec says otherwise | `grid-two-column` |
| Below `md` (<768px) | Tables drop to their essential columns; modals fill the viewport; form fields grow to 16px | Below |
| Below `sm` (<640px) | Stat tiles become rows | Below |

**Inside a two-column screen, a region responds to its own width, not the viewport's.** From `lg`
up the main column loses 336px to the rail at exactly the width where the viewport gains it, so a
card grid keyed on viewport width would go from two columns to one as the window gets *wider*.
Regions that reflow — card grids, the facts card — use Tailwind's container queries (`@container`
on the column, `@xl:` on the grid), and each spec states the width in `rem`.

**The rail column is always `grid-two-column`'s 336px.** The prototype draws four rail widths — 336,
340, 380 and 420px — which is the same drift [tokens §1](../tokens.md) found in its paddings, not
four decisions.

### Tables below `md`

A `DataTable` stays a `<table>` at every width. It does not scroll sideways and it does not reflow
into cards — the first puts half of a money table off-screen, and the second loses the row and
column association that is the reason it is a table ([components §7](../components.md)).

Instead, every column has a **priority**, and each spec lists them:

| Priority | Below `md` |
| --- | --- |
| `primary` | Always shown. The row's name, and the click target where the row is clickable |
| `figure` | Always shown. The one value the table exists to compare, right-aligned |
| `control` | Always shown. A checkbox or a toggle the row cannot be used without |
| `fold` | Hidden, and its value is appended to the `primary` cell's note line as text |
| `detail` | Hidden, and reachable by opening the row |

A hidden column is `hidden md:table-cell` on both its header and its cells, which also takes it out
of the accessibility tree — correct here, because the folded note carries the same text.

### Stat tiles

Tile rows are `repeat(auto-fit, minmax(168px, 1fr))`, which gives five across on a wide column and
wraps without a breakpoint table. 168px is the narrowest tile that holds `$123,456` at `--text-2xl`
inside the tile's padding.

**Below `sm`, `StatTile` lays out as a row** — label and sub-line on the left, the figure on the
right — so five tiles cost about 280px of a phone rather than 450. One component with a responsive
layout, not a second component.

### Modals below `md`

`Modal` fills the viewport: no radius, no visible scrim, header and footer pinned, body scrolling
between them. A two-column modal body stacks, rail last. The footer's primary action is reachable
without scrolling at every width, which is the reason the footer is pinned.

### Form fields

Labels sit above fields at every width. Below `md` an `Input`, `Select` trigger or `Textarea` is
`text-lg` (16px), because iOS Safari zooms the page when a focused field is smaller than 16px; from
`md` up it is the design's `text-sm`. This lives in the three primitives, once, and settles
[components §13](../components.md)'s input question.

A validation message sits under its field in `--status-danger`, is tied to it with
`aria-describedby`, and says what to change rather than what is wrong.

### Building or unit

A capital item or a task belongs to the whole building or to one unit
([data-model §3, §5](../../data-model.md)). **Scope is always written, never only coloured.**

- **`ScopeLabel`** renders it: `Shared` for a null `unit_id`, the unit's label otherwise (`Unit B`,
  `Upstairs`). On a portfolio-level list it sits in the building cell's note line — `412 Sumner St`
  over `Unit B`. On a building's own page it is the group heading.
- **A building's page groups by scope.** Any table of capital items or tasks on a building with more
  than one unit renders one `<tbody>` per group — `Shared` first, then each unit in label order —
  each opened by a header row (`<th scope="rowgroup">`). A duplex's roof and unit B's dishwasher are
  visibly in different places.
- **A scope filter** appears above those tables when the building has more than one unit: `All`,
  `Shared`, then one per unit. Same chip as the contact book's trade filter, a `<button>` with
  `aria-pressed`.
- **A single-unit building shows no scope at all** — no label, no groups, no filter. With one unit
  the distinction changes no figure, and rendering it would put a word on every row that says
  nothing.

### Figures built on estimates

[tokens §10](../tokens.md): a derived figure inherits the lowest confidence of its inputs. Marking
every such figure with a badge would mark nearly every figure in a new org, so the rule is carried
by a sentence instead: **any tile, card or chart built on at least one estimated install year says
how many**, in its sub-line or caption — `4 of 12 install years estimated`. Where there is room,
that sentence links to the building's equipment table filtered to estimated items, which is PRD
F2's "audit these N items to tighten your forecast" prompt.

A single estimated value — one install year in one row — keeps the six-property treatment in
[tokens §10](../tokens.md) and its `ConfidenceBadge`.

### Dates

`DateValue` is absolute at every width ([components §6](../components.md)). Two relative things are
allowed *beside* a date, never instead of it, because they are statuses rather than dates: lateness
(`Aug 24` · `8 days late`) and time to due (`Sep 14` · `in 4 days`). The prototype's "flagged 9 days
ago" becomes `added Aug 23`.

"Today" is today where the building is ([ADR-0005](../../adr/0005-identifiers-money-dates.md)).
A portfolio-level count, such as tasks due in the next 30 days, evaluates each task against its own
building's date.

The prototype's header date stamp (`Sep 01 2026`) is dropped. On a portfolio spanning time zones
there is no single date the page is "as of", and the stamp would be the viewer's.

### Money

`Money` renders full figures in tables, tiles and statements. The compact form (`$39.7k`) is for
chart labels and runway rows, where the full figure is one click away. **The tax planner never uses
the compact form.**

### What the URL holds

State a person would want to link to, reload, or reach with the back button lives in the search
params: the Maintenance tab, the trade filter, the scope filter, the forecast's building and year,
and an open task (`?task=<id>`). A tile's link is always one of these URLs or an anchor on the same
page, which is how "every tile links to the surface that owns its number" becomes a URL rather than
a click handler.

State nobody links to stays in the component: the quote wizard's step
([components §7](../components.md)), a form's unsaved input, which access code is revealed.

### Empty, loading and errors

Per [components §10](../components.md), every list, table and chart has an **empty** state, an
**empty-because-filtered** state, and a **loading** state. Each spec gives the copy.

- **Loading** is a route-level `loading.tsx` of `Skeleton`s at the real row heights, so nothing
  jumps when the data lands.
- **A failed read fails the page, not a region.** The route's `error.tsx` renders inside the shell
  with a retry. These screens cross-reference their own figures — tiles summarise the lists beneath
  them — and a page that silently drops one region shows totals that no longer add up, which is
  worse than no page. The same reasoning as the tax rule in `CLAUDE.md`.
- **A failed write stays at the control.** The control returns to its previous value, a line under
  it says what did not save, and a form keeps what was typed. A toast alone is not an error report:
  it disappears, and on a narrow screen it covers the control it is about.
- **A record that does not resolve is a 404** — the same one for "does not exist" and "belongs to
  another org", so a URL cannot be used to test whether an id exists.

### Undo

One-click writes — marking rent paid, checking off a task, adding a batch of equipment — take effect
immediately and offer **Undo** in a `Sonner` toast for five seconds. There is no confirmation dialog in front of a
one-click action; the undo is the safety, and a dialog would turn a monthly one-click job into two.

Deleting anything that carries history — a building, a unit, a contact — is not one click. It is an
archive, from the record's edit form, and it says what stays attached.

---

## Gaps these specs found

Writing the screens against the schema turned up things the screens need and nothing yet stores.
Each is named in the spec that needs it; they are collected here so none of them is discovered by
a migration. Each has an issue, and the issue is where it gets settled — the lean here is where the
specs left it.

| Gap | Issue | Needed by | Lean |
| --- | --- | --- | --- |
| ~~**The reserve** — a balance, its as-of date, a monthly contribution~~ | [#92](https://github.com/hbouwers/capexwise/issues/92) | [Forecast](capex-forecast.md), the rail's `SidebarStat`; F3 is v0 | **Settled:** one per org, three columns on `organizations` ([data-model §2](../../data-model.md)), entered whole or not at all. A building shows its *need* |
| **Task confirmation** — booked with the assignee, or not yet | [#93](https://github.com/hbouwers/capexwise/issues/93) | [Maintenance](maintenance.md#scheduled)'s Status column; PRD F5 | `tasks.confirmed_on date`, null while awaiting |
| **Assigning to yourself or a member** — `assignee_contact_id` names only contacts | [#94](https://github.com/hbouwers/capexwise/issues/94) | [Task modal](modal-task-detail.md#the-form); PRD §5's small groups | A nullable `assignee_user_id` beside it, at most one of the two set |
| ~~**A contact's rate** — `$75 / hr`, `Bid basis`~~ | [#95](https://github.com/hbouwers/capexwise/issues/95) | [Contacts](contacts.md#the-contact-modal), the task modal's rail, the quote wizard | **Settled:** `contacts.rate_note text`, free text ([data-model §6](../../data-model.md)), with #106 |
| **A planned year and a planned classification** for work not yet done | [#96](https://github.com/hbouwers/capexwise/issues/96) | [Tax planner](tax-planner.md#repair-or-improvement)'s decisions and levers, saving a forecast deferral, F8's `Apply to plan` | Nullable `planned_year` and `planned_classification` on `capital_items`. v1, and it blocks F4's decisions card |
| ~~**A past month whose occupancy differs from today's**~~ | [#97](https://github.com/hbouwers/capexwise/issues/97) | [Rent roll](building-detail.md#units--rent) | **Settled** with #108 ([data-model §4](../../data-model.md)): a `vacant` flag on the period, left out of both halves of every total, and `Record rent`, which opens a month for a unit with no period with the expected amount typed |

And the rules a screen needs in order to display a figure, proposed here and owned by the module
that computes them — each wants a unit test before it is trusted:

| Rule | Proposed | Spec |
| --- | --- | --- |
| Install-year seed | `max(build_year, this year − round(0.6 × life))` | [Add equipment](modal-add-equipment.md#the-seed) |
| Big ticket | Replacement cost of $5,000 or more | [Portfolio](portfolio.md#your-buildings) |
| Systems life used | Replacement-cost-weighted mean of age over life, each item capped at 100% | [Portfolio](portfolio.md#your-buildings) |
| Building flag | Past life, then due soon, then a big-ticket year within three, then healthy | [Portfolio](portfolio.md#your-buildings) |
| Reserve needed / mo | The smallest level contribution that keeps the reserve at or above zero for ten years. **Timing settled** 2026-09-16: a replacement is paid in January of its year, and contributions since the balance's as-of date are not counted | [Forecast](capex-forecast.md#ten-year-capital-plan) |
| Marking a past month paid | Records it on the period's first day, not today. **Settled** with #108: `paidOn` in `src/lib/rent.ts` | [Rent roll](building-detail.md#units--rent) |

---

## What this does not settle

- **Copy owned elsewhere.** The tax disclaimer's wording is
  [#38](https://github.com/hbouwers/capexwise/issues/38)'s; the specs mark where it goes and use
  placeholder text marked as such.
- **Forecast and tax arithmetic.** Where a spec needs a rule to display a figure — how the systems
  life figure is weighted, what makes a replacement big-ticket — it states the rule as proposed and
  names the module that owns it. The module's tests are where it becomes true.
- **Onboarding** — [#39](https://github.com/hbouwers/capexwise/issues/39). These are the screens a
  set-up org uses. The fastest path from nothing to a populated building is #39's to design, and it
  may replace the building form here rather than extend it.
- **Print** — [#45](https://github.com/hbouwers/capexwise/issues/45), still.
