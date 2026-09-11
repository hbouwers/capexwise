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
