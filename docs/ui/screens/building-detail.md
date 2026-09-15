# Building detail

| | |
| --- | --- |
| Route | `/buildings/[buildingId]` |
| Release | v0 |
| PRD | F1, F2, F5 — the building's facts, rent, equipment and recurring work |
| Prototype | the `isProperty` block — "Property detail" in its rail |

PRD F1's "primary workspace": everything about one building, and the place its monthly and
seasonal jobs get done.

---

## Page header

| | |
| --- | --- |
| Title | The building's `label`, or `address_line1` when it has none |
| Subtitle | The full address when the title is a label; otherwise `{city}, {region} {postal_code}`. Then `· {n} units · built {build_year}` |
| Actions | `Edit building` (secondary), to [`/buildings/{id}/edit`](building-form.md). `Add equipment` (primary), opening [the add-equipment modal](modal-add-equipment.md) |

The rail's **Portfolio** item is the current page here: a building is reached from its card, and
[components §4](../components.md) removed the nav entry for "the" building. `isCurrent` in
`sidebar-nav.tsx` matches `/buildings/` to `/` when this route lands.

The first line of the page body is a link, `← All buildings`, to `/`.

---

## Layout

```
← All buildings
┌ Summary: StatusBadges, StatTile × 3 ───────────────────────────────┐
├ Units & rent ──────────────────────────────────────────────────────┤
├ Building facts ────────────────────────────────────────────────────┤
├ Recurring tasks ─────────────────────────────┬ rail (336px) ───────┤
│                                              │ Seasonal rhythm     │
│                                              │ Replacement runway  │
├ Equipment & capital items ───────────────────┴─────────────────────┤
└────────────────────────────────────────────────────────────────────┘
```

Full-width regions, with one `grid-two-column` band for the recurring tasks and their rail — the
prototype's order, with the rent roll added second because it is the job done most often here.

---

## Regions

### Summary

A row of `StatusBadge`s, then three `StatTile`s.

| Badge | When |
| --- | --- |
| `{n} units · all occupied` / `{o} of {n} occupied` | Always, neutral |
| The building card's flag ([portfolio.md](portfolio.md#your-buildings)) | Always, same rule and variant |
| `Archived` or `Sold` | When the building's status is not `active`, neutral |

| Tile | Figure | Sub-line | Links to |
| --- | --- | --- | --- |
| **Rent / mo** | Current rent of the occupied units | `{o} of {n} units occupied` | `#units`, the rent roll below |
| **CapEx through {next year}** | Replacement cost of active items due by next year | `{n} items, {p} past life` | `#equipment`, the table below |
| **Ten-year need / mo** | The next ten years of replacements, level-funded — their total over 120 months | `to fund the next ten years evenly` | `/forecast?building={id}` |

`StatTile`'s link is required ([components §6](../components.md)), and two of these three own
nothing but a region further down the same page, so they link to it.

**Ten-year need replaces the prototype's "Reserve".** The prototype shows each building holding its
own reserve balance, and the reserve is the org's, not a building's
([data-model §2](../../data-model.md), #92). A building's *need* is computable from its capital
items and is the figure a per-building page can stand behind; the balance it is measured against
belongs to the forecast. Level funding is a simplification the forecast module owns and can
replace; the sub-line states it so the figure is not read as more.

### Units & rent

PRD F1's rent roll and Paid checkoff, which the prototype predates. A `Card` with `id="units"`,
headed `Units & rent`, with a month switcher and a `DataTable` — the rent roll of
[components §7](../components.md).

**The month switcher** is `‹ September 2026 ›`: two buttons and the month between them, in the
`?month=2026-09` search param. It stops at the current month, because rent periods open lazily on
first view ([data-model §4](../../data-model.md)) and viewing a future month would snapshot today's
rent into it. It goes back to the month the building was acquired, or two years when that is not
entered, so a year can be back-filled for the tax planner. A param outside that range lands on its
nearest end, and the current month is the page with no param. **Neither step is prefetched**: a
prefetch of last month would open it, and a month nobody looked at would read `Not marked`.

| Column | Priority | Content |
| --- | --- | --- |
| Unit | `primary` | The unit's label; note line `Lease ends {Mon YYYY}` when there is one |
| Expected | `fold` | `Money`, the period's snapshotted amount |
| Received | `figure` | See below |
| Paid | `control` | See below |

A **footer row** totals expected and received for the month.

A row with a month of rent expected is in one of four states:

| State | Received | Paid |
| --- | --- | --- |
| **Not marked** | `—`, and a `Not marked` warning badge for a past month | `Mark paid` |
| **Paid** | `Money` and the date — `$2,300` · `Sep 3` | `Paid`, pressed; pressing it again un-marks |
| **Partial** | `$1,200 of $2,300` and the date, with a `Partial` warning badge | `Paid`, pressed |
| **More than expected** | `$2,400`, with a note `$100 more than expected` and the date | `Paid`, pressed |

And a row with none is one of three ([#97](https://github.com/hbouwers/capexwise/issues/97)):

| State | Received | Paid |
| --- | --- | --- |
| **Vacant that month** | `Vacant`; note line `No rent expected` | `Record rent`, opening the form with `Vacant this month` ticked |
| **No period** — a vacant unit, or a let one with no rent entered | `Vacant`, or `Rent not entered` | `Record rent`, opening the form with the unit's rent as the expected amount |
| **Retired** | Its month as it was recorded, note line `Retired` | As the month's state |

- **`Mark paid` is one click** and records the expected amount — on today's date in the building's
  zone for the current month, and on the period's first day for a past month, because back-filling
  January in September should not record January's rent as received in September. Undo in a toast.
- **`Other amount`** is a small text button beside every Paid control. It opens a `Popover` with the
  amount received, the date received, the amount expected (editable, per
  [data-model §4](../../data-model.md) — a retroactive rent change is corrected here), a note, and
  `Vacant this month`. A partial or late payment is recorded this way; lateness is simply the date.
  The date is prefilled with the one `Mark paid` would record, and only means something beside an
  amount. Nothing received is an empty field, never `$0`.
- **`Vacant this month`** is for a month the unit stood empty, whatever its status today — occupied
  now, empty then. The month stays on the roll as `Vacant`, expects nothing, and is left out of the
  footer and of every other total. It is a mark on the row, not a removal, because the next view of
  the month would open a removed row again ([data-model §4](../../data-model.md)).
- **`Record rent`** is how rent is recorded for a month the unit has no period for — vacant now,
  let then. It opens the same form, and saving opens the month with the expected amount as typed.
- **A past month left unmarked is `Not marked`, never "unpaid".** The product does not know it was
  not paid; it knows nobody said. On the current month, a line under the table names the earlier
  months with unmarked periods — `August has 1 unit not marked` — each a link to that month. A
  vacant month is marked.
- **A unit with no period** is excluded from the footer, and so is a vacant month.
- **A retired unit** has a row in the months it has a period, and none after. Its months stay where
  they were recorded.

Mark paid, un-mark and Other amount are server actions. The table re-renders from the server's
answer; nothing is computed in the browser.

### Building facts

A `Card` headed `Building facts` with an `Edit` button, holding four `FactGroup`s: **Access**,
**Services**, **Utility accounts** and **Average bill**. Four across when the card is at least 56rem
wide, two from 32rem, one below.

**Access** lists each row of `building_access_codes`: the label and kind as the `FactRow` label
(`Rear door · door code`), a `ScopeLabel` when the code is a unit's, and a `MaskedValue`. Each value
has its own `Reveal` button ([components §9](../components.md), findings 5–7):

- The masked render ships no plaintext and the mask is a fixed eight dots.
- `Reveal` calls a server action that opens that one row, logs that a reveal happened and never the
  value, and returns it. The button becomes `Hide`.
- The value re-masks after 60 seconds, or when the page is left. A reveal is an event with an
  audit trail ([#42](https://github.com/hbouwers/capexwise/issues/42)); a code that stays on
  screen indefinitely makes the trail describe less than happened.
- `last_rotated_at`, when set, is a note: `changed Mar 2026`.

**Services**: trash and recycling days from `building_facts` (`Thursday` · `recycling every other
Tuesday`), then each `lawn` and `snow` row of `building_utilities` — provider name, and the linked
contact's name with their phone as a `tel:` link.

**Utility accounts**: each remaining utility row — kind as the label, then provider and the account
stub (`National Grid · acct ••4192`), and `tenant-paid` when it is. The stub is the four characters
the schema allows and is not a secret, so it is not a `MaskedValue`.

**Average bill**: each utility with an average — `$186 /mo`, with `tenant` beside tenant-paid ones —
and an **Owner-paid** total beneath a rule, summing only `paid_by = 'owner'`. Tenant-paid bills are
listed because knowing them helps price a unit, and excluded from the total because the owner does
not pay them.

`Edit` opens a `Modal`, 720px, with the card's groups as form sections. **An access code field
never shows the current code** — pre-filling it would mean decrypting every code to render a form.
The field is empty with a `Replace code` placeholder, and leaving it empty keeps the code; typing
one replaces it and dates the `changed` note.

- **Access** — a row per code: kind, label, scope on a multi-unit building, and the code. `Add a
  code` adds one, whose code is required. Removing a row deletes the code on save.
- **Services** — trash day, recycling day and its schedule, then a row per lawn or snow service:
  company, contact from the contact book, average bill and who pays it. A service needs a company
  or a contact.
- **Utility accounts** — a row per account: kind, scope on a multi-unit building, provider, the
  account number's last four characters, average bill, and who pays it. A longer account number is
  refused with a message rather than cut to four, because the first four are the wrong four.

**Average bill is a field on each row, not a fourth section.** A bill belongs to its account, and a
section of its own would ask for it away from the row it belongs to; the card still shows it as its
own group, where the owner-paid total needs it. Closing a changed form asks `Discard your changes?`,
the contact modal's rule.

### Recurring tasks

`grid-two-column`'s main column. A `Card` headed `Recurring tasks`, the summary
`{n} overdue · {n} done this year`, and a `DataTable` of the building's tasks that have a
`recurrence_months`, grouped and filterable by scope ([README](README.md#building-or-unit)).

| Column | Priority | Content |
| --- | --- | --- |
| Done | `control` | `Checkbox` — completes this occurrence |
| Task | `primary` | Title as a link to `?task={id}` ([the task modal](modal-task-detail.md)); note line is the first line of its notes |
| Frequency | `fold` | `Every 3 months`, `Annually` … |
| Next due | `figure` | `DateValue`, with `{n} days late` in `--status-danger` or `in {n} days` in `--status-warning` inside 21 days |
| Cost | `fold` | Estimated cost |

Checking a row completes it and materialises the next occurrence
([data-model §6](../../data-model.md)); the row stays in place with its new due date, and a toast
says `Next due {date}` with Undo.

**An inline add row** closes the table: an `Input` (`Add a recurring task — e.g. seal the
driveway`), a `Select` of frequency, a scope `Select` on a multi-unit building (default `Shared`), and
`Add task`. The first due date is one interval from today, and the toast says so; the task modal
changes it.

Frequencies are **Monthly, Every 3 months, Every 6 months, Annually, Every 2 years** — the
`recurrence_months` values 1, 3, 6, 12 and 24.

### Seasonal rhythm

The rail's first card, rendered when the building has recurring tasks. A `SeasonalStrip` of January
to December: each month's bar counts the building's recurring tasks falling due in it over a year,
from each task's next due date and its interval. The current month's initial is `--text-primary`.
Each bar carries its text — `October: 4 tasks` — as its accessible name, and the strip is a list of
twelve items rather than twelve decorative boxes.

### Replacement runway

The rail's second card: a `RunwayList` of the next five calendar years for this building — year, the
items by name (`AC condenser, washer, carpet`), and compact `Money`. A year with nothing due reads
`Nothing due`. Each row links to `/forecast?building={id}&year={year}`.

The prototype skips empty years and shows 2029 then 2031. The same component on the portfolio shows
five consecutive years, so this one does too — and a year with nothing due is information.

The prototype's caption, `Set aside $640/mo here … You are banking $400`, needs a per-building
contribution nobody stores. The need half is the summary's third tile; the banking half is a
[gap](README.md#gaps-these-specs-found).

### Equipment & capital items

A full-width `Card` with `id="equipment"`, headed `Equipment & capital items`, the summary
`{n} items · {a} audited, {e} estimated`, and `Add equipment`. Above the table, the scope filter and
one more chip, `Estimated only`, in the `?confidence=estimated` param — the target of every "audit
these items" link in the product.

| Column | Priority | Content |
| --- | --- | --- |
| Item | `primary` | Label, as a button opening the item's editor; note line is its category |
| Installed | `fold` | `DateValue` year in the §10 confidence treatment, a `ConfidenceBadge`, and `Confirm` on an estimated item |
| Age vs life | `fold` | `LifeBar` with `11 / 15 yr` in text |
| Replace | `figure` | The replacement year |
| Est. cost | `fold` | Replacement cost |
| Status | `fold` | `StatusBadge` — Past life, Due soon, Watch, Healthy |

Sorted by replacement year, soonest first, within each scope group. A foot row gives the total
replacement value. Beneath the table, the note:

> Estimated install years assume each item is 60% of the way through its typical life, and never
> older than the building. Confirm an item once you have read its label — audited items tighten the
> forecast.

That sentence describes the seed rule in [the add-equipment modal](modal-add-equipment.md). The
prototype's version says ages "come from build year", which is not what its own code does.

**`Confirm`** opens a small `Modal`, not a one-click write: PRD F2 has it prompt for the actual
install date and cost, and the schema requires the date for an audited item. Fields: install date
(required), what it cost (optional). Saving flips the badge.

**The item editor** is a `Modal` with the item's fields — label, install year and confidence, the
install date when audited, expected life, replacement cost, scope, notes — and two actions that are
not edits:

- **`Record replacement`** asks for the new item's install date and cost, creates it as a new,
  audited row, and marks this one replaced. It does not edit this row's install year, which would
  erase the history the tax planner needs ([data-model §5](../../data-model.md)).
- **`Remove`** marks the item removed, for equipment that is gone and not replaced. Removed and
  replaced items leave this table and the forecast; a `Show replaced and removed` link at the
  table's foot brings them back, muted.

On narrow viewports the row's `Item` button is how `Confirm` is reached — the editor has it too.

---

## Changes from the prototype

- **The building's name appears once**, as the page title. The prototype prints it in the header bar
  and again at `--text-xl` in a banner beneath, which leaves `--text-xl` without its one use here;
  it stays in the scale rather than being removed, which would be a tokens change.
- **Summary badges are computed.** "Gas heat · central AC" is free text with no column behind it and
  is dropped. "Basis $712,000" is a tax figure outside the tax page and without its disclaimer, and
  moves to [the tax planner](tax-planner.md). "duplex" becomes a unit count, because the schema has
  no building type and the unit count is the fact.
- **One reveal per code**, fixed-width masks, and no plaintext in the page
  ([components §9](../components.md)).
- **The recurring task frequency is text, not a `<select>` in every row.** Eight selects are eight
  more tab stops, and on a phone a scroll that catches one changes a schedule. It changes in the
  task modal.
- **"As needed" is not a frequency.** A task with no interval is a one-off, and belongs on
  Maintenance as unscheduled work.
- **The rent roll is new**, and so are Confirm's prompt, the item editor and `Record replacement`.

---

## Narrow viewports

- **Below `lg`** the seasonal rhythm and runway follow the recurring tasks.
- **Below `sm`** the summary tiles are rows, and the month switcher's month is abbreviated
  (`‹ Sep 2026 ›`).
- **`Reveal`, `Mark paid` and `Other amount` are at least 44px tall below `md`**, above WCAG 2.5.8's
  24px minimum. A door code is read on a doorstep, one-handed.
- The Other amount popover becomes a `Modal`, per [the shared rule](README.md#modals-below-md).

---

## States

| State | What renders |
| --- | --- |
| **No equipment** | The equipment card's `EmptyState`: `No equipment yet` / `Check off what the building has, and we estimate each install year to start from.` / `Add equipment`. The summary's CapEx and need tiles read `$0` with the sub-line `No equipment recorded` |
| **No recurring tasks** | `No recurring tasks yet` in the table body, with the inline add row beneath it — the add row is the action. The seasonal rhythm card is not rendered |
| **No facts** | Each empty group reads `Not recorded`, and the card's `Edit` is the action |
| **Filtered to nothing** | `No {Shared / Unit B / estimated} items` and a `Clear filter` button |
| **Archived or sold** | A neutral line above the summary — `Archived. Kept for its history; it is left out of the portfolio's figures.` — and no `Add equipment` or inline add. The rent roll has no Paid column and opens no month, since nothing on it can be marked. `Edit building` stays, which is where it is restored |
| **Not this org's, or not a building** | 404 |
| **Reveal failed** | Under the code: `Couldn't reveal this code. Try again.` The mask stays |
| **Loading** | The summary, a three-row rent table, the facts card's four groups, five task rows, eight equipment rows |
