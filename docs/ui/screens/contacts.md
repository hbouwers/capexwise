# Contact book

| | |
| --- | --- |
| Route | `/contacts` |
| Release | v0 |
| PRD | F6 |
| Prototype | the `isContacts` block |

The org's vendors and professionals, filterable by trade, reusable across every building.

---

## Page header

| | |
| --- | --- |
| Title | `Contact book` |
| Subtitle | `Vendors and professionals, tagged by trade` — as built |
| Actions | `Add contact` (primary), opening the contact modal with `?contact=new` |

---

## Layout

```
┌ Filter by trade · 15 of 15 shown ────────────────────────────────────┐
│ [All 15] [Handyman 1] [HVAC 2] [Plumber 1] …                          │
├ ContactCard grid ─────────────────────────────────────────────────────┤
└───────────────────────────────────────────────────────────────────────┘
```

One column: a filter row, then a grid of `ContactCard`s, `repeat(auto-fill, minmax(17rem, 1fr))` —
three across on a wide screen, as drawn.

---

## Regions

### Trade filter

A `FieldLabel` `Filter by trade`, the count `{shown} of {total} shown`, and a row of `TradeChip`s in
their filter state: `All`, then **only the trades at least one contact has**, each with its count.
Nineteen chips, most reading zero, is the prototype's version; a chip that filters to nothing is a
button with no use.

One trade at a time, in `?trade={slug}`, so the task modal can link to a filtered book. Chips are
`<button aria-pressed>`.

### Contact cards

Sorted by name. Each `ContactCard`:

| Part | Content |
| --- | --- |
| Name | `--text-md`, weight 500, as a link to `?contact={id}` |
| Company | Beneath, `--text-xs` |
| Trades | `TradeChip`s, display state |
| Phone | A `tel:` link |
| Email | A `mailto:` link |
| Foot | The rate note, and `last used {Mon YYYY}` — the most recent completed task assigned to them — or `not used yet` |

**The card is not one link**, unlike a building card: it holds a phone link and an email link, and
links cannot nest. The name is the way in. A link rather than a button, because what it does is go
to a URL: it opens in a new tab like any other link, and the card stays a presentational component
that renders on the server.

**`last used` is derived**, from `tasks.completed_on` where they were the assignee, so it cannot go
stale. The prototype's `Jun 2019` for an inspector nobody has used since is exactly the figure a
hand-maintained field gets wrong.

### The contact modal

`?contact={id}` or `?contact=new`, a `Modal` at 560px, on the same URL pattern as
[the task modal](modal-task-detail.md).

| Field | Notes |
| --- | --- |
| Name | Required |
| Company | |
| Trades | A checkbox list of every trade, in two columns from `sm` up. `?contact=new&trade=hvac` arrives with HVAC ticked |
| Phone, Email | `type="tel"`, `type="email"` |
| Rate | Free text — `$75 / hr`, `Bid basis`, `8% of gross`. `contacts.rate_note`, which this [gap](README.md#gaps-these-specs-found) added |
| Notes | `Textarea` |

An existing contact's footer has `Archive contact` on the left. It asks in the footer before it
acts — `Archive {name}?` over `Keeps them on past tasks, and takes them out of this book and the
assignee lists.` — rather than in a second dialog, so the question sits where the button was.
Archived contacts come back through a `Show archived ({n})` link at the foot of the grid, into an
`Archived` section under the same trade filter as the rest of the page. One opens in the modal with
`Restore contact` where `Archive contact` was, and stays editable.

Contacts are other people's personal data — names, phones, emails. None of it is logged, per
`CLAUDE.md`, including in a failed save's error.

---

## Changes from the prototype

- **No star ratings.** They are not in PRD F6 and have no column, and a one-to-five score of a named
  local tradesperson is a judgement about a real person that the product would then be holding. A
  sentence in the notes does the same job and says why.
- **Only trades in use get a chip.**
- **Phone and email are links.** In the prototype they are text.
- **Adding and editing are new.**

---

## Narrow viewports

- **Below `md`** the chip row stops wrapping and scrolls sideways inside itself, with `All` first —
  nineteen wrapped chips would push the first contact below the fold. The page itself never scrolls
  sideways.
- **Below `sm`** cards are one column, and phone and email become full-width rows at least 44px tall:
  on a phone, calling is what the card is for.

---

## States

| State | What renders |
| --- | --- |
| **No contacts** | No filter row, and an `EmptyState`: `No contacts yet` / `Add the people who work on your buildings, and tag them by trade so tasks can find them.` / `Add contact` |
| **No trade in use** | No filter row either: a row holding only `All` filters nothing |
| **Filtered to nothing** | Only reachable by URL, since empty trades have no chip: `No contacts tagged {trade}` and `Show all`. A `?trade=` that is not a trade at all filters nothing |
| **The contact does not exist or is not this org's** | The task modal's rule: the page renders without the modal, with a line at the top of the page body — `That contact wasn't found.` |
| **Unsaved changes on close** | Also the task modal's: `Cancel`, `×`, Escape and the scrim ask `Discard your changes?` in the footer. Unchanged, they close at once |
| **Save failed** | The modal stays open with everything typed, and the footer says what did not save |
| **Loading** | The chip row and six card skeletons |
