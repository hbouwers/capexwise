# Add equipment modal

| | |
| --- | --- |
| Opened by | `Add equipment` on [a building's page](building-detail.md) — the page header and the equipment card |
| Release | v0 |
| PRD | F2 |
| Component | `AddEquipmentModal`, 920px, of `CatalogGroup`s ([components §7](../components.md)) |
| Prototype | the `showAdd` block |

A checklist of the catalogue: tick what the building has, and each item arrives with a service life,
a replacement cost and an estimated install year. It is the fastest way from an empty building to a
forecast, which makes it the first thing [#39](https://github.com/hbouwers/capexwise/issues/39)
will want to reuse.

**Not in the URL.** A half-ticked checklist is not something anyone links to, and closing the modal
discards it — the same reasoning as the quote wizard ([README](README.md#what-the-url-holds)).

---

## Header

`Add equipment to {building name}`, and beneath it:

> Tick what the building has. Each item starts with a typical service life and cost, and an
> estimated install year — 60% of the way through its life, and never before {build year}. Confirm
> them later, once you have read the labels.

When the building has no build year, the last clause of the first sentence is dropped.

---

## Body

The five `CatalogGroup`s of `capital_item_types.item_group`, in catalogue order: **Kitchen**,
**Laundry**, **HVAC & water**, **Envelope**, **Interior & systems**. Each is a `<fieldset>` whose
`<legend>` is the group's name, with a `Select all` button that becomes `Clear` when every item in
the group is ticked.

Items sit in three columns when the body is at least 48rem wide, two from 32rem, one below. Each is
a `Checkbox` with a real `<label>`:

| Part | Content |
| --- | --- |
| Name | The type's label |
| Seed | `est. 2014 · 20 yr life · $6,800` — the install year this building gets, the type's life and cost |
| Tracked | `{n} tracked`, when the building already has that type |
| Scope | Once ticked, on a multi-unit building: a `Select` — see below |

**Already tracked is a note, not a lock.** The prototype replaces the seed with "already tracked"
as though a building can only have one of a thing. A duplex has two refrigerators.

### Scope

PRD F2: scope is a per-item choice, and the checklist proposes it. A ticked item on a building with
more than one unit shows a `Select`:

| Option | Creates |
| --- | --- |
| **Each unit** | One item per non-retired unit, each scoped to it |
| **Shared** | One item, building-scoped, allocated by unit count |
| **Unit A**, **Unit B** … | One item, scoped to that unit |

The proposal is the type's `default_scope`: a unit-scoped type starts on **Each unit**, a
building-scoped one on **Shared**. `Each unit` is the default for unit-scoped types because it is
nearly always right — every unit of a duplex has its own range — and it turns one tick into the two
rows the building actually has.

**HVAC & water is where the proposal is most often wrong**, which is why the choice is shown on
every ticked item rather than behind a disclosure: two furnaces on a shared water main, or one boiler
for both units, are both common, and the catalogue cannot know which.

On a single-unit building there is no scope control, and everything is scoped to the building.

### The seed

The install year is `max(build_year, this year − round(0.6 × life))`, or the second term alone when
the build year is not known. The prototype's modal says it seeds from the build year and its code
does something else — 60% of life, floored at 1990 — so the rule is written down here, and the
header copy describes it exactly. It is F2 logic, and its tests belong with the forecast maths:

- **60% of life**, because an item of unknown age is more likely mid-life than new or failing, and it
  makes a new building's forecast start with plausible spread rather than everything due at once.
- **Never before the building**, because the building's age is the one hard fact available, and the
  prototype's 1990 floor is a number with no reason.

Everything added is `estimated`. Life and cost are copied onto the item at add time
([data-model §5](../../data-model.md)), so a later catalogue refresh does not move them.

---

## Footer

Pinned. The summary on the left — `6 items · $24,300 of replacement value · all estimated`, counting
`Each unit` as its real number of items — or `Nothing ticked yet.` Then **the defaults' age**:
`Lives and costs are national defaults, last updated {date}`, the latest `defaults_updated_at`, which
is PRD §11's visible staleness signal. On the right, `Cancel`, and `Add {n} items` (primary), which is
`Add items` and disabled until something is ticked.

Adding closes the modal. The equipment table shows the new rows, and a toast says
`Added 6 items` with Undo — which removes exactly those rows, and is safe because nothing can refer
to them yet.

---

## Changes from the prototype

- **Scope per item.** The prototype has none; F2 requires it
  ([components §7](../components.md)).
- **The seed rule is stated**, and the copy describing it is true.
- **"Already tracked" does not replace the seed**, and does not stop a second one being added.
- **The defaults show their age**, and the seed shows the cost as well as the life.

---

## Narrow viewports

Full screen below `md`. One column of items below 32rem, with each ticked item's scope `Select`
under its name rather than beside it. The five group headings stay sticky inside the scrolling body,
so a long list never loses which group it is in.

---

## States

| State | What renders |
| --- | --- |
| **Add failed** | The modal stays open with every tick in place, and the footer says what did not save. Nothing is half-added: the rows are inserted in one transaction |
| **Closing with ticks** | Asks `Discard your selection?` |
| **Archived building** | The action is not offered ([building-detail.md](building-detail.md#states)) |
