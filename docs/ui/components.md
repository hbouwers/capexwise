# Component inventory

**Status:** v1 — the component contract to build against
**Source:** `docs/ui/reference/rental-manager.html`, read 2026-09-08. Values from
[`docs/ui/tokens.md`](tokens.md)
**Issue:** [#11](https://github.com/hbouwers/capexwise/issues/11)

Second of the three UI handoff documents. [`tokens.md`](tokens.md) settled the *values*; this
settles the *names* and the *boundaries*, so the per-screen specs
([#12](https://github.com/hbouwers/capexwise/issues/12)) can say "a `DataTable` of `CapitalItemRow`"
instead of describing markup again on six screens.

`src/components/ui/` exists as of [#15](https://github.com/hbouwers/capexwise/issues/15) and is the
source of truth for the implementation. This stays the source of truth for **what exists, what it is
called, which layer it lives in, and which rule it owns.** The domain and composed layers in §6 and
§7 are not built yet.

---

## 1. How this was derived

The prototype has no component boundaries. It is 1,669 lines of inline-styled `<div>`s in which
every element is spelled out at every use — the same card container written thirty-one times, the
same micro-label written fifty-nine. Naming is therefore a counting exercise, the same one
[`tokens.md` §1](tokens.md) ran on values.

A thing earns a name when it meets one of two tests:

1. **The same structure appears more than once**, especially across screens.
2. **It carries a rule that must not be re-implemented** — confidence, masking, status mapping,
   the mono rule. These get a component even at one use, because the second use is where the rule
   gets copied wrong.

| Pattern in the prototype | Elements in the markup | Becomes |
| --- | --- | --- |
| Card container — 9px radius | 31 | `Card` (shadcn) |
| Mono numeric span | 149 | `Numeric` / `Money` |
| Uppercase mono micro-label | 59 | `FieldLabel` |
| Grid row template | 31 uses, 18 distinct column sets | `DataTable` + 8 real tables |
| Tinted badge or chip | 27 | `StatusBadge`, `TradeChip`, `ConfidenceBadge` |
| Meter track and fill | 15 | `Meter`, `LifeBar` |
| Accent-filled button | 8 | `Button variant="primary"` |
| Two-option segmented control | 3 | `SegmentedControl` — but see §7, it is two things |
| Modal shell | 2 | `Modal` |

Those are elements written out in the template. What renders is larger, because most of them sit
inside a loop — one `ConfidenceBadge` in the markup is twelve badges on a building with twelve
capital items.

Eighteen distinct grid templates sounds like eighteen tables. It is not: ten are page layout
(`minmax(0,1fr) 336px` is a two-column screen, not a table) and eight are the real tabular column
sets, listed in §7.

Six screens — portfolio, building detail, tasks, contacts, CapEx forecast, tax planner. Two modal
shells, one of which hosts a four-step wizard, which is why
[#12](https://github.com/hbouwers/capexwise/issues/12) counts three modals.

---

## 2. Naming rules

**A building is a building.** The prototype says "property" everywhere; `CLAUDE.md` forbids it. The
issue's `PropertyCard` is **`BuildingCard`**, `propRunway` is building runway, and the "All
properties" back-link is "All buildings". The word survives only in its tax sense (basis, placed in
service) and its trade sense.

**Semantic tokens only.** A component references `--surface-card`, never `--white` and never
`#ffffff`. This is what keeps dark mode's reversal cost low ([tokens §12](tokens.md)) and it is why
the primitive layer exists.

**The mono rule is enforced by a component, not by discipline.** `Numeric` and `Money` set the
family, the tabular figures and the tracking. A bare `{item.cost}` in JSX is the bug — 149 numeric
spans is too many to keep right by hand, and the one that slips is the one on the tax page.

**Domain names, not visual names.** `ConfidenceBadge`, not `DashedBadge`. The dash is this year's
rendering of the rule; the rule is the component.

---

## 3. The three layers

```
L0  App shell        AppShell, Sidebar, PageHeader …        one instance, wraps everything
L1  Primitives       shadcn/ui, restyled by the tokens      no domain knowledge
L2  Domain           Money, ConfidenceBadge, LifeBar …      knows CapExWise, knows no screen
L3  Composed         BuildingCard, YearBarChart, modals …   assembled from L1 + L2
```

Two import rules, and they are the whole point of the layering:

- **L1 never imports L2.** A restyled `Button` that knows what a capital item is cannot be replaced
  when shadcn changes.
- **L2 never imports L0.** A component that reaches for the shell cannot be rendered in a modal, and
  every one of these eventually is.

---

## 4. Layer 0 — the app shell

| Component | What it is | Notes |
| --- | --- | --- |
| `AppShell` | Sidebar + main column | Owns `--sidebar-width` (238px) and the page grid |
| `Sidebar` | Fixed left rail | Brand, nav, footer stat, user chip |
| `NavGroup` | Labelled nav section | Two in the prototype: **Manage**, **Plan** |
| `NavItem` | One destination | Dot, label, optional count badge |
| `SidebarStat` | The reserve-health block in the rail footer | A `Meter` plus a caption; not a separate chart |
| `UserChip` | Avatar, name, "5 buildings · 8 doors" | Becomes the account menu trigger |
| `OrgSwitcher` | **Not in the prototype.** | [#29](https://github.com/hbouwers/capexwise/issues/29). The prototype is single-org; the product is not |
| `PageHeader` | Sticky 64px bar: title, subtitle, actions | `--header-height`, `rgba(250,249,247,.9)` + `blur(8px)` over a 1px bottom border — no shadow, per [tokens §8](tokens.md) |
| `PageActions` | The right-hand button cluster | Date stamp, secondary action, primary action |

`PageHeader`'s title and subtitle are per-screen strings; every screen has both, and #12 owes the
pair for each.

---

## 5. Layer 1 — shadcn primitives, and the density overrides

The design is denser than shadcn's defaults at every control. [tokens §7](tokens.md) deliberately
left `--spacing` at Tailwind's 4px so that shadcn's internals stay predictable — which means the
density lands **here**, as a known list of overrides, rather than as a global rescale nobody can
audit.

Measured from the prototype against shadcn's defaults, then **re-measured at
[#15](https://github.com/hbouwers/capexwise/issues/15) against what `shadcn init` actually
installed** — 4.21.0, base `radix`, preset `nova`. That version is markedly denser than the one this
table was first written against, which changes the answer in both directions: half the planned
overrides turned out to be unnecessary, and two corrections nobody had predicted appeared.

| Primitive | Installed default | Prototype | Applied |
| --- | --- | --- | --- |
| `Button` default | `h-8`, `px-2.5`, `rounded-lg` | 33px, `10px 18px`, 12.5px/500 | `px-4`, `rounded-md`. Height and weight already matched |
| `Button` sm | `h-7`, `px-2.5`, `text-[0.8rem]` | 29px, `8px 14px` | `px-3.5 text-sm`. `text-[0.8rem]` is 12.8px, off the scale |
| `Input` | `h-8`, `px-2.5`, `text-base` | 33px, `10px 12px`, 12.5px | `px-3 text-sm`, `rounded-md` |
| `Select` trigger | `h-8`, and a built-in `size="sm"` at `h-7` | 33px page / 26px in-table | `rounded-md`, `pl-3`. **The dense variant already exists** — no `dense` prop needed |
| `Badge` | `h-5`, `px-2 py-0.5`, 12px sans, `rounded-4xl` | `3px 8px`, 10px mono/500 | `px-2 py-[3px] font-mono text-micro tracking-label rounded-sm`, and the fixed height dropped so padding sets it |
| `Card` | `py-4`/`gap-4`, `rounded-xl`, **`ring-1`** | 18–22px padding | `p-5 gap-4`, `rounded-lg`, and the ring replaced by a 1px border |
| `Dialog` | `sm:max-w-sm`, `rounded-xl`, `p-4`, `ring-1` | 900/920px, `--radius-xl`, `22px 26px` | Border plus `--shadow-modal`; per-modal width and sectioned padding still owed, see §7 |
| `Table` cell | `p-2` | 9–11px vertical, 12–14px horizontal | `px-3 py-2.5` |
| `Tabs` list | `bg-muted p-[3px] rounded-lg`, trigger `rounded-md` | `4px` track, 9px outer / 6px inner radius | **Nothing.** The shape and both radii already match |

Two of those are worth stating as findings rather than table rows, because they are the design
principle rather than the density:

**The installed `Card` and every popover surface separate themselves with a `ring`, and the
dropdowns add a `shadow-md`.** [tokens §8](tokens.md) says every separation in this design except a
modal is a 1px border. Clearing Tailwind's shadow scale in `globals.css` means `shadow-md` no longer
generates, so this correction cannot silently come back with the next component that is added.

**Radius drifted one whole step.** The installed `Card` is `rounded-xl`, which in our scale is 12px
— the *modal* radius. The signature card radius is 9px, and the two being adjacent is exactly why
this was worth measuring rather than eyeballing.

Primitives used as-is beyond those: `Label`, `Textarea`, `Checkbox`, `Separator`, `DropdownMenu`,
`Tooltip`, `Skeleton`, `Popover`, `Progress`, `RadioGroup`, `Sonner` (toasts — nothing in the
prototype, but the rent checkoff and the Confirm action both need an undo affordance). That list
plus the table above **is** the installed set; nothing else is added until a screen needs it.

`Sheet` is the first primitive added under that rule, by the app shell
([#29](https://github.com/hbouwers/capexwise/issues/29)): the rail becomes a drawer below `lg`, and
a drawer is a modal dialog anchored to an edge — which is what `Sheet` is, on the same Radix
`Dialog` the `Dialog` above uses. It got the `Dialog` treatment: `cn` from `@/lib/cn`, the
`--surface-overlay` scrim in place of `bg-black/10` and a backdrop blur, `--border-modal` plus
`--shadow-modal` in place of `shadow-lg`, and the title's `text-base` — which does not generate,
because the type scale is cleared — moved to `text-md`.

Three things that apply across all of them:

- **Focus is one rule, not nineteen.** The installed primitives each carry
  `outline-none focus-visible:ring-3 focus-visible:ring-ring/50` — a 3px ring at 50% alpha, which is
  weaker than [tokens §9](tokens.md) specifies and has to be repeated on every new component. Both
  are stripped, and `globals.css` applies the §9 tokens once via a bare `:focus-visible` rule, so a
  component written next year is covered without anyone remembering to cover it. The
  `focus-visible:border-*` change stays as the secondary cue.
- **They import `cn` from `@/lib/cn`, not from `cn`.** See [tokens §13](tokens.md) — the default
  merge table silently eats our custom font sizes. `shadcn add` writes the bare import, so this is a
  step to repeat when a component is added.
- **The `dark:` classes are left in place.** Nothing sets `.dark` ([tokens §12](tokens.md)), so they
  are inert; removing them is a large diff that the next `shadcn add` would undo.

`Table` is the one worth a sentence. shadcn's renders a plain `<table>`, which is what we want; the
prototype's tables are CSS grid on divs, which is not. Translating the grid templates into `<col>`
widths is the adaptation to make, not a reason to keep the divs. See §7.

---

## 6. Layer 2 — domain components

These are the ones worth writing down, because each owns a rule.

| Component | What it is | Base | Rule it owns |
| --- | --- | --- | --- |
| `Numeric` | Any figure rendered as a value | custom | IBM Plex Mono, `--leading-none`, `tabular-nums` on any sans fallback |
| `Money` | `Numeric` for cents | custom | Takes **integer cents**, never a float. One formatter, per `CLAUDE.md`. Renders `$8,400`; compact `$39.7k` is a prop, not a second component |
| `DateValue` | A date or a year | custom | Mono. Absolute, never "3 days ago" — every date on this product is a planning date |
| `DeltaValue` | A signed change | `Numeric` | Sign is always rendered (`−$5,400`, `+$44,800`). Colour is secondary to the sign; a minus sign survives a screenshot |
| `FieldLabel` | The uppercase mono micro-label | custom | `--text-micro`, weight 500, `--tracking-label`, `--text-muted`. 59 uses; the single most repeated thing in the design |
| `StatTile` | Label / figure / sub-line | `Card` | Supports the split value (a big `3` with an inline "overdue"). Every tile links to the surface that owns the number — a PRD F0 requirement, so the link is required, not optional |
| `ConfidenceBadge` | `ESTIMATED` / `AUDITED` | `Badge` | The six-property swap in [tokens §10](tokens.md). **The word is the primary signal**; the dashed border reinforces it |
| `StatusBadge` | Tinted label | `Badge` | Foreground and tint always come from the same status pair. Five variants; see §9 for why seven labels collapse to five |
| `PriorityPill` | High / Medium / Low | `StatusBadge` | An alias, not a component. Medium changes colour — §9 |
| `TradeChip` | One trade tag | `Badge` | Filter chips and display chips are the same chip in two states |
| `LifeBar` | Age against expected life | `Meter` | Thresholds 60 / 85 / 100 % → Healthy, Watch, Due soon, Past life. **Always paired with the percentage in text** |
| `Meter` | A single-value bar | `Progress` | Track `--meter-track`, top-only radius on chart bars. Length is the encoding; colour is redundant ([tokens §11](tokens.md)) |
| `MaskedValue` | Access codes | custom | Masked by default. **Fixed-width mask, reveal is a server action** — §9 |
| `FactRow` / `FactGroup` | Label-over-value pairs in the facts card | custom | Four groups: Access, Services, Utility accounts, Average bill |
| `EmptyState` | **Not in the prototype** | custom | Title, one line, one action. Every list needs one; see §10 |
| `PlanGate` | Wraps a premium surface | custom | Reads `can(org, feature)` from props, never from the client ([#29](https://github.com/hbouwers/capexwise/issues/29)) |
| `PremiumBadge` | The `PREMIUM` pip | `Badge` | Cosmetic. `PlanGate` does the gating; this only labels it |
| `TaxDisclaimer` | The planning-aid-not-advice notice | custom | Required copy, not a nicety — PRD F4 and [#38](https://github.com/hbouwers/capexwise/issues/38). Persistent on every tax surface, not dismissible |

`EmptyState` and `OrgSwitcher` are the only two components in this document that cannot be
extracted, because the prototype has neither. That is a property of prototypes, not of the design.

---

## 7. Layer 3 — composed components

### `DataTable`

Eight real tables, one component. The prototype's grid templates become column definitions:

| Table | Screen | Columns |
| --- | --- | --- |
| Recurring tasks | Building detail | check, task, frequency, next due, cost |
| Capital items | Building detail | item, category, installed, age vs life, replace, est. cost, status |
| Unscheduled work | Tasks | priority, task, building, trade, est. cost, assignee |
| Scheduled work | Tasks | check, task, building, assignee, frequency, date, cost, status |
| Year items | CapEx forecast | name, building, basis, cost, tag |
| Relevant contacts | Task modal | name + rate, company, phone |
| Quote recipients | Quote wizard | check, name, company + trade, rate + last used |
| Catalog items | Add-equipment modal | check, name, seeded life |

**It renders a real `<table>`.** The prototype uses `display:grid` on divs, which gives no row or
column association to a screen reader — on a table of money, that is the difference between "eight
thousand four hundred" and "Furnace, estimated cost, eight thousand four hundred". Column widths
carry over as `<col>` widths from the grid templates; `table-layout: fixed` reproduces the
`minmax(0,1fr)` behaviour closely enough that nothing needs redrawing.

Conventions the component enforces, all of them visible in the prototype and none of them stated
there:

- Numeric columns are right-aligned and `Money`/`Numeric`-rendered.
- A two-line cell is a primary line plus a `--text-muted` note at `--text-2xs`.
- The row is the click target where a row is clickable — and then it is a `<tr>` containing a
  `<button>` or `<a>`, not a `<div onClick>`. See §9.
- Header cells are `FieldLabel`.

### Charts and figures

| Component | What it is | Notes |
| --- | --- | --- |
| `YearBarChart` | The 10-year forecast, clickable by year | Selected year is the page's state, not the chart's. Bar fill is binary in the prototype (`> $30k`), not a ramp — keep it binary and label the axis |
| `RunwayList` | Year / items / cost rows | Appears twice: five years on the dashboard, five on the building. Same component, different scope |
| `SeasonalStrip` | Twelve month mini-bars | Heat keyed on task count: 0, 1–2, 3, 4+ → `--heat-0`…`--heat-3`. Month initials below, always |
| `ReserveMeter` | Reserve health, banked against needed | Used in the sidebar and on the CapEx screen |
| `IncomeStatement` | The Schedule E–shaped list | Label/value rows, a rule above the total, `DeltaValue` for the computed lines. Every line traces to its inputs — PRD F4 |
| `TimingLeverList` | Title / mechanism / delta | Static in the prototype; the deltas are F4 output |

### Cards and rows

| Component | Notes |
| --- | --- |
| `BuildingCard` | Photo, name, meta, flag chip, three-stat footer, `LifeBar`. The **flag** is a computed summary string in the prototype ("4 past life", "healthy", "furnace 2028") — it needs a stated rule, or it is untestable. Proposed: worst-severity item count, else the nearest big-ticket year, else "healthy" |
| `ContactCard` | Name, company, rating, trade chips, phone/email, rate + last used |
| `DecisionRow` | Repair-vs-improvement row on the tax screen, with its saving |
| `AdviceCard` | F8 recommendation: title, why, capex/tax pair, confidence note, apply action. **Must show its inputs** — PRD F8 |
| `CatalogGroup` | One checklist group with "Select all" |

### `SegmentedControl` — one visual, two semantics

The same two-option pill control appears three times and means different things:

| Use | Semantics | Base |
| --- | --- | --- |
| Unscheduled / Scheduled | Swaps which view is shown | `Tabs` |
| Repair / Improvement | Sets a value on a record | `RadioGroup`, styled as the segmented control |
| Text / Email | Sets a value on a form | `RadioGroup` |

Building all three as `Tabs` because they look alike gives two form controls that do not submit,
do not participate in a form, and announce themselves as tabs. This is the kind of thing an
inventory exists to catch.

### Modals

| Component | Width | Notes |
| --- | --- | --- |
| `Modal` | — | Shell: `--radius-xl`, `--border-modal`, `--shadow-modal`, `--surface-overlay` scrim, `max-height: 88vh`, header / scrolling body / sticky footer |
| `TaskDetailModal` | 900px | Notes, date, assignee, priority, cost, make-recurring, contacts rail |
| `QuoteWizard` | 900px | Steps 1–3 inside the same shell: pick recipients → compose → sent. **v2** (PRD F7) |
| `AddEquipmentModal` | 920px | Catalog grouped by Kitchen / Laundry / HVAC & water / Envelope / Interior. Per-item scope choice is a PRD F2 requirement the prototype does not render — the checklist proposes building or unit and the user confirms ([#48](https://github.com/hbouwers/capexwise/issues/48)) |

The wizard's step state belongs to the modal, not to a route. Nothing in it is linkable and a
half-composed quote request is not a resumable resource.

---

## 8. Presentation versus server data

The issue asks which components are pure presentation and which take server data. The honest answer
is that the second category should be **empty**, and the rule is worth stating as strongly as the
raw-db rule it follows from:

> **No component fetches its own data.** A page or route handler resolves org context with
> `getOrgContext()`, reads through `db.forOrg(orgId)`, and passes plain props down.

Component-level fetching is how a client-supplied org id gets somewhere it should never be, and it
is how a component ends up importing the raw client to "just read one thing". Every component below
is therefore either presentational or interactive; none is connected.

| Category | Meaning | Members |
| --- | --- | --- |
| **Presentational** | Props only. No state, no effects, renders on the server. | `Numeric`, `Money`, `DateValue`, `DeltaValue`, `FieldLabel`, `StatTile`, `ConfidenceBadge`, `StatusBadge`, `PriorityPill`, `TradeChip`, `LifeBar`, `Meter`, `FactRow`, `FactGroup`, `SeasonalStrip`, `RunwayList`, `IncomeStatement`, `TimingLeverList`, `ContactCard`, `BuildingCard`, `EmptyState`, `PremiumBadge`, `TaxDisclaimer`, `PageHeader`, `NavGroup` |
| **Interactive** (`"use client"`) | Local UI state only — open, selected, revealed, filtered. | `Sidebar`/`NavItem` (active route), `OrgSwitcher`, `Modal` and all three modals, `QuoteWizard`, `SegmentedControl`, `Tabs`, `YearBarChart` (selection), `TradeChip` filter row, `DataTable` where rows are clickable or contain controls, `CatalogGroup`, `DecisionRow`, `MaskedValue` |
| **Server-mutating** | Interactive, and calls a server action. | `MaskedValue` (reveal), `DecisionRow` (classification), `LifeBar`'s Confirm action, rent checkoff, task checkoff, `AdviceCard`'s apply |

`PlanGate` is the exception that proves the rule: it is presentational, and it takes the resolved
capability as a prop. A gate that asks the client whether the client is premium is not a gate.

---

## 9. What the components must correct

The prototype is a visual reference, not an implementation reference. Seven things do not carry
forward, and they are recorded here so that "match the prototype" never reintroduces them.

**1. Nothing in the prototype is keyboard-reachable.** Zero `<button>` elements, zero `<a>`
elements, 43 click handlers, all on `<div>` or `<span>`, and 51 `cursor: pointer` declarations. This
is the largest single finding at the component layer, and it is invisible in a screenshot. Every
click target is a `<button>` or an `<a>`, and `:focus-visible` comes from
[tokens §9](tokens.md).

**2. Two status colours fail AA as text, and they are already fixed in the tokens.** The
prototype's `PRI` map renders **Medium** priority in `#b07d1a` (3.62:1), and the life-state map
renders **Watch** in the same value. [tokens §2](tokens.md) demoted `#b07d1a` to fills only.
`StatusBadge` and `PriorityPill` use `--status-warning` (`#8a6417`, 4.85:1 on its tint) for both.

**3. Seven status labels, five variants.** The prototype's `TAGS` map has seven entries, and
`Discretionary` is `#8b857b` — a non-text value under [tokens §2](tokens.md). `Planned` and
`Discretionary` share a tint and differ only in a text colour that fails; they collapse onto
`--status-neutral`. Distinguishing them, if they need distinguishing, is a wording job, not a colour
job. This corrects [tokens §3](tokens.md)'s vocabulary table, which listed six labels — it missed
`Discretionary`.

**4. The premium gate is not blurred.** The issue describes "the blurred 'Upgrade to see them'
panel"; the prototype's is a plain text-and-button panel, and the only `blur()` in the file is the
sticky header's backdrop filter. Build the plain panel — a blurred panel implies the content was
sent to the client, which is the opposite of what a gate does. Its body copy uses `#8b857b` and
moves to `--text-muted`.

**5. `MaskedValue` leaks the code length.** The prototype masks `"4417#"` as `"•••••"` and `"2280"`
as `"••••"`. The mask is fixed-width regardless of value.

**6. A reveal is a server action, not a client toggle.** The prototype holds every code in client
state and swaps the string, which means the codes are in the page payload and "masked by default" is
decoration. Given [#31](https://github.com/hbouwers/capexwise/issues/31) (encrypted at rest) and
`CLAUDE.md`'s never-log-a-code rule: the masked render ships no plaintext, revealing calls a server
action that decrypts one value, and the action logs that a reveal happened —
[#42](https://github.com/hbouwers/capexwise/issues/42) — never the value.

**7. Reveal is per value, not per card.** The prototype's single toggle reveals all three codes at
once. One audit-log entry saying "revealed the access section" is not the record #42 wants.

---

## 10. Empty, loading, and error states

The prototype has **no empty state anywhere** — every list is populated with demo data. That is the
gap most likely to be discovered late, because the first real org sees the empty version of every
screen before it sees any other version, and onboarding speed is already a first-class design
problem ([#39](https://github.com/hbouwers/capexwise/issues/39)).

Each of the eight tables, the building list, the contact list, and every chart needs three states
beyond the populated one:

- **Empty** — `EmptyState` with a title, one line of explanation, and the one action that fixes it.
- **Empty because filtered** — different copy and a clear-filter action, never the onboarding copy.
- **Loading** — `Skeleton` at the row height, so the layout does not jump. The design's 1px-border
  hierarchy makes layout shift unusually visible.

Errors are per-surface, not global, and are #12's to specify per screen.

---

## 11. Motion

[tokens §14](tokens.md) left this open, correctly noting that the prototype having no transitions at
all is not evidence of a decision. Deciding it here:

```css
--duration-fast:   120ms;  /* colour and border on hover, focus ring */
--duration-base:   180ms;  /* disclosure, dropdowns, tab and segment changes */
--duration-slow:   240ms;  /* modal enter, scrim fade */
--ease-standard:   cubic-bezier(0.2, 0, 0, 1);
```

Three rules:

- **Motion never carries information.** Nothing is communicated only by an animation — a status
  change that animates also changes a word.
- **Nothing that reports a number animates its value.** A counting-up KPI on a tax page invites
  reading a figure mid-count.
- `prefers-reduced-motion: reduce` collapses every duration to `1ms` and drops transforms entirely,
  keeping opacity changes. It is a global rule in `globals.css`, not a per-component prop.

---

## 12. The sans family

[tokens §4](tokens.md) deferred this to #11 with real rendering in front of it. Rendered, on this
Windows machine, at the design's own sizes: the prototype's stack
(`'Helvetica Neue', Helvetica, Arial, sans-serif`), Segoe UI, and IBM Plex Sans, each beside
IBM Plex Mono numerals.

**Decision: IBM Plex Sans**, self-hosted through `next/font`, weights 400/500/600.

Two things the specimen settled that reasoning alone would not have:

**The three-weight system does not exist on the system stack.** The prototype uses the sans at
weight 500 nineteen times and at 600 twenty-six times — buttons, nav items, emphasised names,
headings. Arial on Windows ships Regular and Bold and nothing between, so every 500 renders as 400
and every 600 renders as Bold. Segoe UI has a Semibold but no Medium. Forty-five deliberate weight
choices become two weights, and the middle tier of the type hierarchy disappears on the machine the
product is being built on. IBM Plex Sans has all three as real faces.

**Numbers appear in both families constantly, and only Plex makes them relatives.** The mono rule
puts values in Plex Mono and numbers-inside-sentences in the sans — "built 1912", "25 yr life",
"acquired Jun 2019" — so both digit designs sit on screen together in every row. Plex Sans and Plex
Mono share a skeleton, so the same figure reads as the same figure at two widths. Arial's and Segoe
UI's digits are unrelated designs, and the mismatch is most visible exactly where the design is
densest.

The system stack stays in the token as the fallback list while the webfont loads. Cost of reversal:
one line in `@theme`, which is why this is decided now rather than deferred again.

---

## 13. What this does not settle

- **Per-screen composition and copy** — [#12](https://github.com/hbouwers/capexwise/issues/12).
  Which components each screen uses, in what order, with what strings, and what happens to each on
  a narrow viewport. Nothing here is responsive yet; the prototype is desktop-only at a hard
  `min-width: 1240px`, and that constraint is #12's to replace.
- **Input font size on a narrow viewport** —
  [#12](https://github.com/hbouwers/capexwise/issues/12). §5 puts the input at `text-sm`, which is
  13px, and iOS Safari zooms the page when a focused input is under 16px. The design is 12.5px, so
  the desktop value is not in question; what a form field does below 768px is a mobile decision the
  screen specs have to make, along with everything else the prototype's `min-width: 1240px` left
  undefined.
- **`can(org, feature)` and the org switcher** —
  [#29](https://github.com/hbouwers/capexwise/issues/29). `PlanGate` and `OrgSwitcher` are named
  here and specified there.
- **Rent roll components.** PRD F1's monthly rent period and one-click Paid checkoff
  ([#48](https://github.com/hbouwers/capexwise/issues/48)) have no prototype equivalent at all —
  the prototype predates them. `RentRollTable`, `RentPeriodRow` and the checkoff belong to whoever
  builds F1, following the `DataTable` conventions in §7.
- **Chart thresholds** — PRD F3. `LifeBar`'s 60/85/100 come from the prototype and are plausible;
  the reserve meter's are forecast logic.
- **Print** — [#45](https://github.com/hbouwers/capexwise/issues/45). No component has been looked
  at on paper, and `MaskedValue` in particular needs a stated print behaviour.
