# Building form

| | |
| --- | --- |
| Route | `/buildings/new`, `/buildings/[buildingId]/edit` |
| Release | v0 |
| PRD | F1 |
| Prototype | none — the prototype has one hard-coded building and no way to add another |

Not in [#12](https://github.com/hbouwers/capexwise/issues/12)'s list, because the prototype never
draws it, and v0 cannot be done without it: its definition of done is two duplexes and four units
entered. [#39](https://github.com/hbouwers/capexwise/issues/39) owns making entry *fast*; this is
the plain form that makes it possible, and #39 may replace it.

A page rather than a modal. It is the longest form in the product, and a page gets a URL, the back
button and a reload that does not throw the form away.

---

## Page header

| | |
| --- | --- |
| Title | `Add a building`, or `Edit {building name}` |
| Subtitle | `Address, units, and what you paid` |
| Actions | none — the form's own buttons are at its foot |

---

## Layout

One column of `Card`s, at most 40rem wide, each a form section with a heading. The footer is a row:
`Cancel` (secondary, back to where the form was opened from) and `Save building` (primary).

### Address

| Field | Required | Notes |
| --- | --- | --- |
| Name | no | `label`. Placeholder `e.g. The Elm Street duplex`. When empty, the address is the name everywhere |
| Street address | yes | `address_line1`, then an optional second line |
| City, State, ZIP | yes | Three fields, one row from `sm` up. State is free text: the schema does not assume the US |
| Time zone | yes | A `Select` of IANA zones, defaulting to the viewer's. The helper says why it is asked: `Due dates and "today" follow the building's clock.` |

### The building

| Field | Required | Notes |
| --- | --- | --- |
| Year built | no | `build_year`. Helper: `Used to estimate how old the equipment is.` |

### Units

One row per unit — label, occupied or vacant, monthly rent, lease end — and `Add another unit`. A
new building starts with one row labelled `A`, and adding a second relabels nothing. At least one
unit is required, because every figure on the building's page is per unit or summed over units.

Rent and lease end are only asked for an occupied unit; a vacant one keeps its asking rent if it has
one. Changing a unit's rent here changes the rent of periods not yet opened, and says so beneath the
field: `Months already recorded keep the rent they had.` That sentence is [data-model
§4](../../data-model.md)'s snapshot rule, in the one place a person could believe the opposite.

On the edit form, a unit with rent history has `Retire` instead of a remove button, and a retired
unit is listed muted with `Restore`.

### Purchase and basis

Optional, and collapsed behind `Add purchase details` on a new building. Helper: `Used by the tax
planner. Enter all of it or none of it.`

| Field | Notes |
| --- | --- |
| Acquired on | Date |
| Placed in service | Date, defaulting to the acquisition date. Helper: `When it was first available to rent. Depreciation starts here.` |
| Purchase price | `Money` input |
| Capitalized closing costs | `Money` input. Helper: `Only the costs added to basis — not prepaid taxes, insurance or interest.` |
| Land value | `Money` input |
| Building value | **Computed, not typed** — price plus capitalized closing costs, less land. Shown live, as a `Numeric` |
| How the split was made | `Select`: county assessment ratio, appraisal, or entered by hand, and a note field for the source |

The all-or-nothing rule is [data-model §3](../../data-model.md)'s `buildings_basis_complete`
constraint, and the form enforces it before the database has to: if any of price or land is filled,
both are required, and the building value is never a separate input that could disagree with the
other three. A building with no basis entered is valid, and the tax planner says `Basis not entered`
rather than inventing one.

"Capitalized closing costs" is worded exactly that way because the constraint adds the field to
basis, and a person asked for "closing costs" would enter all of them.

### Archive

On the edit form only, at the foot, separated by a rule: `Archive building`, with the line `Keeps its
history, and leaves it out of the portfolio's figures.` It confirms in a `Modal`, because archiving
removes the building from every total on the dashboard. Selling a building is
[#43](https://github.com/hbouwers/capexwise/issues/43)'s.

---

## Narrow viewports

- The column is full width below `sm`, and City, State and ZIP stack.
- Unit rows become a small stacked group per unit — label and status on one line, rent and lease end
  on the next.
- Fields are 16px below `md`, per [the shared rule](README.md#form-fields).

---

## States

| State | What renders |
| --- | --- |
| **Validation failed** | Every failing field's message at once, and focus moves to the first. The server repeats every check, and its messages render the same way |
| **Saved** | New: to the new building's page, with a toast `Building added. Add its equipment next.` whose action opens the add-equipment modal. Edit: back to the building's page |
| **Unit capacity** | The free plan's single unit is billing's to enforce ([PRD §12](../../PRD.md)). When it is, `Add another unit` past the allowance is replaced by the reason and where to upgrade — never by a disabled button with no explanation |
