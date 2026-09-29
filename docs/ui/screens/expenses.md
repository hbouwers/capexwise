# Expenses

| | |
| --- | --- |
| Route | `/expenses` |
| Release | v1 |
| PRD | [§12](../../PRD.md), question 5 — expense entry, for F0's cash flow and F4's statement |
| Prototype | none — "it adds a screen the prototype never drew" |

Money out, recorded by hand: what was spent, on which building, in which Schedule E category. The
other half of the cash flow tile and the records half of the tax planner. `transactions` is
already specified ([data-model §6](../../data-model.md)); this is its screen.

Not a bookkeeping ledger — [PRD §4](../../PRD.md) rules out accounting-grade books. It is the list
of spend a small landlord would otherwise keep in a spreadsheet for their CPA.

---

## Page header

| | |
| --- | --- |
| Title | `Expenses` |
| Subtitle | `Money out, by building and Schedule E category` |
| Actions | `Add expense` (primary), opening the expense modal with `?expense=new` |

**A rail entry**, `Expenses`, in the Manage group after Maintenance. This is the first destination
added to [the shell's five](../components.md), and it is the only v1 screen that needs one.

---

## Layout

```
┌ Month switcher · filters ────────────────────────────────────────────┐
├ StatTile × 3: Rent received, Spent, Cash flow ───────────────────────┤
├ DataTable ───────────────────────────────────────────────────────────┤
└──────────────────────────────────────────────────────────────────────┘
```

One column.

---

## Regions

### Filters

The month switcher from [the rent roll](building-detail.md#units--rent) — `‹ September 2026 ›`,
`?month=`, with `This year` as a further choice — and two `Select`s: building (`?building=`) and
Schedule E category (`?category=`). The dashboard's cash flow tile links here with the month set.

### Tiles

| Tile | Figure | Sub-line | Links to |
| --- | --- | --- | --- |
| **Rent received** | Received in the period | `of {expected} expected` | `/#buildings`, whose cards each open a rent roll |
| **Spent** | Recorded expenses in the period | `{n} expenses` | `#ledger`, the table below |
| **Cash flow** | Received less spent, as a `DeltaValue` | `{month} · {year} to date {ytd}` | `#ledger` |

This is the screen that owns the cash flow number, which is why the dashboard's tile comes here:
the spend side is the table beneath, and the rent side is one click away through the building
cards.

### The table

`id="ledger"`.

| Column | Priority | Content |
| --- | --- | --- |
| Date | `fold` | `DateValue` |
| Description | `primary` | As a button opening `?expense={id}`; note line is the building with `ScopeLabel`, and the linked task or item |
| Category | `fold` | Schedule E category |
| Classification | `fold` | Repair, Improvement or Unclassified — shown only for the repairs category and capital work |
| Amount | `figure` | `Money`, signed — `−$180` out, `+$40` for a refund |

Newest first, with a foot row totalling the period. `amount_cents` is signed and every other money
column in the schema is not ([data-model §6](../../data-model.md)); the table is where that
difference is visible, so the sign is always rendered.

### The expense modal

`?expense={id}` or `?expense=new`, a `Modal` at 560px.

| Field | Notes |
| --- | --- |
| Date | Required, defaulting to today |
| Amount | Required. Entered as a positive figure with `Money out` / `Refund` beside it; stored signed |
| Building, Scope | Required building; `Shared` or a unit |
| Category | Required. The Schedule E categories, from the reference table that ships with this |
| Description | |
| Classification | Shown for repairs and capital work: Repair, Improvement or Unclassified |
| Linked to | Optional — a task, a capital item, a contact |

**Built for entering a stack of receipts.** `Save and add another` beside `Save` keeps the date,
building and category and clears the rest, with focus back on Amount. Twelve months of receipts is
the onboarding cost PRD §11 worries about, arriving one field at a time.

A completed task can create its expense from [the task modal](modal-task-detail.md#footer), already
linked, and that is the path most maintenance spend takes.

---

## Narrow viewports

- Filters stack under the month switcher below `sm`, and the tiles are rows.
- The table keeps description and amount; the date folds into the note line first, since a list of
  receipts is read by date.

---

## States

| State | What renders |
| --- | --- |
| **Nothing recorded** | Tiles, and an `EmptyState`: `No expenses recorded` / `Record what you spend on your buildings, and the dashboard's cash flow and the tax planner use it.` / `Add expense` |
| **A period with nothing** | `Nothing recorded in {month}.` and the switcher to move on |
| **Filtered to nothing** | `No {category} expenses in {month}` and `Clear filters` |
| **Loading** | The tiles and eight row skeletons |

---

## As built

#142 built this screen. What it settled that the sections above do not say:

- **The tiles follow the period and the building, not the category.** They are the period's cash,
  and filtered to one category, Rent received and Cash flow would stop meaning anything. The
  category filters the ledger, whose foot row totals what it shows.
- **The ledger is exact.** Every amount renders to the cent and signed, `−$182.47` and `+$40.00`,
  where every other table rounds to the dollar. A CPA adds this list up by hand, and a rounded
  column would not add up to its own foot row.
- **Only active buildings are on the page**, as on Maintenance and the forecast. An archived or sold
  building keeps its expenses, because the tax planner needs a sold building's last year, and one
  opened by its id is read-only.
- **The switcher reaches back two years, or to the oldest expense recorded**, whichever is further,
  and stops at the current month, because nothing is recorded after today where its building is.
  Its day is the latest of the buildings', the forecast's rule. In the year view the arrows step
  from the current month.
- **Viewing the current month opens it on the rent roll**, for every active building, as the
  dashboard does, so Rent received is not a zero standing in for a month nobody opened. A past
  month opens nothing.
- **Cash flow's sub-line names the months**: `September · Jan–Sep +$12,400`, rather than
  `2026 to date`. For a month in the past, the year to date stops at that month.
- **The categories are Schedule E lines 5 to 19, less line 18**, since depreciation is computed and
  never paid. There is no capital-improvement category. The spend is filed where it went, and the
  repair-or-improvement question says it is capital.
- **Classification is asked for repairs and for spend on a capital item**, and stored nowhere else.
  An answer left empty is `Unclassified`. Changing a repair to another category drops the
  question with it.
- **The modal links the contact paid and the equipment. It does not link a task.** A task is
  linked only by `Mark done`, and the modal shows that link and keeps it. An expense moved to
  another building leaves its task behind, because a task names its building.
- **An expense is deleted, not voided**, from the modal's footer. One entered twice or against the
  wrong building is a typo, and nothing freezes a year until #44.
