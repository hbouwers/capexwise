# Tax planner

| | |
| --- | --- |
| Route | `/tax` |
| Release | v1. The advisor card is v2 |
| PRD | F4, and F8 for the advisor |
| Prototype | the `isTax` block |

An estimated Schedule E for the year, per building or across the portfolio, and what classifying
or timing the planned work differently would change.

**This is the highest-risk screen in the product** ([PRD §11](../../PRD.md)). Two rules outrank
everything else in this spec: every figure opens to its inputs, and the disclaimer is always on
screen with the figures. Where the prototype's arithmetic and this spec differ, neither is the
reference — the tax module and its tests are, and this page renders what they compute.

---

## Page header

| | |
| --- | --- |
| Title | `Tax planner` |
| Subtitle | `{year} estimate · Schedule E` |
| Actions | A building `Select` (`All buildings`, then each) in `?building=`, and a tax year `Select` in `?year=` |

The year list is the current year until [#44](https://github.com/hbouwers/capexwise/issues/44)
freezes filed years; after that, a filed year opens read-only from its snapshot, and says so.

---

## Layout

```
┌ TaxDisclaimer ──────────────────────────────────────────────────────┐
├ Income statement ───────────────────────────┬ rail (336px) ─────────┤
│ IncomeStatement                              │ Estimated liability  │
├ Repair or improvement? ─────────────────────┤ Timing levers        │
│ DecisionRow list                             │ Advisor (v2)         │
└──────────────────────────────────────────────┴──────────────────────┘
```

---

## Regions

### The disclaimer

`TaxDisclaimer`, the first thing in the page body, full width, above every figure. Not dismissible
and not collapsible, and it prints ([components §6](../components.md)). The wording is
[#38](https://github.com/hbouwers/capexwise/issues/38)'s to settle. Until it is, the placeholder is:

> **Planning estimates, not tax advice.** These figures are projections from what you have entered,
> and the repair-or-improvement calls are yours to confirm with a CPA before you file.

The prototype has no disclaimer at all — the one "not advice" in it is inside a rule-of-thumb
paragraph near the bottom of the page. PRD F4 calls the wording "a requirement, not a nicety".

### Income statement

A `Card` headed `{year} rental income statement`, with `Schedule E · {building}` or
`Schedule E · all {n} buildings` beneath, holding an `IncomeStatement`.

| Line | From |
| --- | --- |
| **Gross rental income** | Rent received this year to date, plus the expected rent of the months still to come |
| **Operating expenses** | Recorded expenses by Schedule E category ([expenses.md](expenses.md)), excluding the two lines below |
| **Mortgage interest** | Recorded expenses in that category |
| **Depreciation, existing basis** | Each building's basis over its recovery period, from its in-service date |
| **Repairs deducted this year** | This year's planned items classified as repairs, below |
| **Depreciation on improvements** | This year's share of planned items classified as improvements |
| **Taxable rental income** | The sum, under a rule |

**Every line is a disclosure.** Each is a `<button aria-expanded>` that opens the inputs beneath it,
and this is how PRD F4's traceability is met on the page rather than in a promise:

- Gross rental income opens to `$140,400 received Jan–Aug` + `$70,200 expected Sep–Dec`, and each
  building's share.
- Operating expenses opens to its categories, each a link to [`/expenses`](expenses.md) filtered to
  the category and year.
- Depreciation opens to one row per building: `Building value $580,000 ÷ 27.5 yr · in service 12 of
  12 months`, and the rule for a building placed in service mid-year.
- The two planned lines open to the items classified into them, each with its own arithmetic.

**A building with no basis entered is named, not skipped.** Its depreciation row reads `Basis not
entered — add it on the building` with a link to [the building form](building-form.md#purchase-and-basis),
and the statement's total carries `Excludes depreciation for 1 building.` The page does not invent
a basis, and does not let a missing one pass silently as a smaller deduction
([data-model §3](../../data-model.md)).

**Shared items show their split.** On a single building, a shared item's line in the disclosure
gives the allocation it was divided by — `Roof: split evenly across 2 units` or the explicit shares —
which [data-model §5](../../data-model.md) calls "the whole disclosure".

### Repair or improvement?

A `Card` with one paragraph of explanation, then a `DecisionRow` per planned item this year.

> A repair comes off this year's income in full. An improvement is capitalized and recovered over
> years. How an item is classified depends on what the work does, and it is a call to confirm with a
> CPA.

| Part | Content |
| --- | --- |
| Name | The item, and its building with `ScopeLabel` |
| Cost | `Money` |
| Classification | `SegmentedControl` on `RadioGroup` — Repair, Improvement ([components §7](../components.md)) |
| Effect | `DeltaValue`: this year's tax effect of the current choice, and `tax effect {year}` beneath |

Changing a classification saves it and re-renders the statement and the liability from the server.
The recomputation is never done in the browser, so the figure on screen is always one the tax module
produced.

**Which items appear, and where their classification is stored, are both open.** "Planned this
year" needs a planned replacement year a person has chosen, and nothing stores a classification for
work that has not happened — `transactions.classification` is for spend already recorded. Both are
[gaps](README.md#gaps-these-specs-found), and this card cannot be built until they are closed.

The de minimis safe harbour threshold is a setting ([PRD F4](../../PRD.md)), and an item under it
says so in its row: `Under the $2,500 de minimis threshold`.

### Estimated liability

The rail's first card. A `FieldLabel` `Estimated {year} liability`, the figure in `--text-3xl` —
the one use of that step — and beneath it the arithmetic in words:
`Taxable rental income × 29% blended rate`. The rate is a field on this card, saved per tax year
([#44](https://github.com/hbouwers/capexwise/issues/44)), because a figure multiplied by a rate
nobody can see is not traceable.

Then, under a rule:

| Line | Content |
| --- | --- |
| **Against doing nothing** | `DeltaValue`: the liability with the current classifications, less the liability with every planned item left unclassified |
| **Effective rate on rents** | Liability over gross rental income |
| **New basis added** | The cost of items classified as improvements |

### Timing levers

A `TimingLeverList`: each planned item that could move between tax years, with the move stated and
its effect — `Move the Sumner roof into Dec 2026` / `$18,500 capitalized · depreciation starts a
year earlier` / `−$195 in 2026`. Each opens its arithmetic like a statement line. It needs the same
planned-year record as the decisions card.

### Advisor

PRD F8, premium, v2. A `PlanGate` for `advisor`: an org without it gets the `PremiumBadge` and one
line, `The advisor is part of Premium.`, and nothing else is computed for it. An org with it gets
`AdviceCard`s, each showing its inputs as F8 requires, and `Apply to plan`.

---

## Changes from the prototype

- **The disclaimer exists**, first and persistent.
- **Every line opens to its inputs.** The prototype's lines are figures with no way in.
- **"Split the rewire across two invoices" is removed, from the levers and from the advisor.**
  Breaking one job into invoices to fit each under the de minimis threshold is restructuring a
  transaction for its tax treatment. A product that says it is not tax advice cannot suggest it.
- **"Cost-segregate the condo" is removed.** Cost segregation is deferred to v1.1 in PRD F4.
- **"Quarterly estimate due Sep 15" is removed.** A quarter of the rental liability is not anyone's
  quarterly payment, which depends on their whole income and their withholding — none of which the
  product knows, so the figure could not be traced to anything.
- **The non-premium teaser is removed.** "Four recommendations are waiting … worth $4,060" means
  computing the premium output for an org that has not paid for it and showing its value. `PlanGate`
  renders nothing behind the gate ([components §6](../components.md)).
- **No building basis in the building's header**; it is here, where the disclaimer is
  ([building-detail.md](building-detail.md#changes-from-the-prototype)).
- **The arithmetic is not the prototype's.** It expenses a repair at a flat rate and recovers every
  improvement over 27.5 years with no convention, which is wrong for an appliance or a carpet. The
  module owns recovery periods and conventions; this page shows its working.

---

## Narrow viewports

- **Below `lg` the liability card comes first**, straight after the disclaimer, then the statement,
  then the decisions, levers and advisor. On a phone the headline figure is what someone came for,
  and the statement beneath is how they check it.
- **Below `sm`** a decision row stacks: name and cost, then the segmented control full width, then
  its effect.
- `--text-3xl` holds at 320px: a six-figure liability is about 200px of mono at 42px, inside the
  card's 240px.

---

## States

| State | What renders |
| --- | --- |
| **No rent or expenses recorded** | The disclaimer, and an `EmptyState`: `Nothing to estimate yet` / `The statement is built from rent you have marked received and expenses you have recorded.` / `Go to your buildings` |
| **No planned items this year** | The decisions card reads `No planned work this year.`, and the levers card is not rendered |
| **A filed year** | Read-only from #44's snapshot, with `Filed {date}. Figures are as filed.` beneath the disclaimer, and no controls |
| **Loading** | The disclaimer renders immediately and is never a skeleton; then the statement's seven rows, the liability card, three decision rows |
