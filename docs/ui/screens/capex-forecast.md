# CapEx forecast

| | |
| --- | --- |
| Route | `/forecast` |
| Release | v0, portfolio view included ([PRD §12](../../PRD.md), question 6) |
| PRD | F3 |
| Prototype | the `isCapex` block |

Every tracked item aged forward to its replacement year, ten years out, against the reserve that
has to pay for it.

---

## Page header

| | |
| --- | --- |
| Title | `CapEx forecast` |
| Subtitle | `Ten-year capital plan, aged from equipment records` — as built |
| Actions | A building `Select` — `All buildings`, then each — in `?building=` |

---

## Layout

```
┌ Ten-year capital plan: three figures, YearBarChart ────────────────────┐
├ {year} — items ───────────────────────────────┬ rail (336px) ─────────┤
│ DataTable                                     │ Reserve projection    │
└───────────────────────────────────────────────┴───────────────────────┘
```

---

## Regions

### Ten-year capital plan

A full-width `Card`: heading `Ten-year capital plan`, one line of description, three figures, the
chart, and a caption.

Description: `Every tracked item, aged forward to its expected replacement year.`

| Figure | Content |
| --- | --- |
| **10-year total** | Replacement cost of everything due this year through nine years out, past-due items included |
| **Reserve needed / mo** | The smallest level monthly contribution that keeps the reserve from going below zero in any of the ten years, from today's balance |
| **Contributing / mo** | The org's stated monthly contribution |

The last two need the org's reserve, three columns on `organizations`
([data-model §2](../../data-model.md), #92). Until one is entered, the second figure is level
funding — the total over 120 months, labelled `to fund the next ten years evenly` as on
[the building page](building-detail.md#summary) — and the third is not rendered. The "needed" rule
is forecast-module logic. The reserve is kept by the month and replacements are known only by the
year, so two timing rules were settled on 2026-09-16, both toward the reading that never overstates
what the reserve can cover:

- **A replacement is paid in January of its year**, before that January's contribution. A roof due
  in 2028 is covered only by what was saved through December 2027. It can fail in February, and a
  December assumption would call the year covered on twelve deposits that may never arrive in time.
  This year's replacements, past-due ones included, come out of the balance at the start of the
  projection.
- **Contributions since the balance's as-of date are not counted.** The projection starts from the
  balance as entered, and the first contribution is the month after this one. CapExWise cannot see
  the account, and a deposit skipped or a repair paid out of the reserve would make a counted
  balance higher than the real one. An old balance shows up as a higher monthly need and its
  `as of {date}`, which is the prompt to update it.

Two more were settled with the module itself (#111), in the same direction:

- **An item comes round again.** Once replaced it is new, and due a life after the year it lands,
  so a five-year smoke detector due this year is in this year's bar and again five years out.
  Counting each item once would understate every later year and the need with them, and five
  catalogue types — detectors, carpet, the sump pump, exterior paint, the dishwasher — live eight
  years or less. A recurrence of an estimated item stays estimated: its year rests on the same
  guess. Costs are today's; nothing is inflated.
- **A shortfall no contribution can reach is paid back, not ignored.** This year's replacements
  come out before the first contribution, and so do next year's when this month is December. If the
  balance cannot cover them the projection shows that year short whatever is saved, so
  `Reserve needed / mo` is asked only of the years a contribution reaches — and the shortfall
  carried into them is what it pays back.

**`YearBarChart`**: ten bars, this year through nine years out. Each bar is the year's replacement
cost, and **this year's bar includes every replacement already past due**, which is what makes it
the same set as the dashboard's End of life tile.

- **Each bar is a `<button aria-pressed>`** selecting its year into `?year=`. Its accessible name is
  the whole bar in words: `2028: $47,100, 7 items, 3 estimated, reserve short`.
- **Fill is binary, and the binary means something.** A year in which the projected reserve goes
  below zero is `--meter-warn`; every other year is `--surface-fill-strong`; the selected year is
  `--accent`. The prototype's binary is "over $30,000", which means nothing on a single building and
  something different on every portfolio. A shortfall year is F3's own requirement — "surfacing the
  years where the reserve goes negative". Until a reserve is entered, no year is marked.
- **Each bar stacks audited cost below estimated cost.** The estimated segment takes the
  [tokens §10](../tokens.md) treatment — card fill, dashed `--border-estimated` — so the share of
  each year that rests on guesses is visible without a second chart.
- **The axis is labelled**: zero and the tallest bar's value in compact `Money`, and the year under
  each bar. Each bar's own compact total sits above it.
- **A legend in words** beneath: `Reserve runs short` beside a swatch, and `Estimated install year`
  beside a dashed one. The legend is text, so neither encoding is colour alone.

The caption carries [the estimate sentence](README.md#figures-built-on-estimates):
`{e} of {n} items have estimated install years.` With one building selected it links to that
building's equipment filtered to estimated; across the portfolio it names each building with its
count, each a link.

### The selected year

The main column. Heading `{year} — {total} across {n} items`, and a `DataTable`:

| Column | Priority | Content |
| --- | --- | --- |
| Item | `primary` | Label, as a link to its building's page; note line is the building, with `ScopeLabel` |
| Why this year | `fold` | `15 yr life · installed 2011 · estimated` — the arithmetic that put it here |
| Cost | `figure` | `Money` |
| Tag | `fold` | `StatusBadge` |
| — | `detail` | `What if?` menu — below |

Sorted by cost, largest first.

**Tags are derived, and only four exist:** **Overdue** (replacement year before this year), **Due**
(this year), **Big ticket** (a later year, at or above the big-ticket threshold in
[portfolio.md](portfolio.md#your-buildings)), and **Planned** (everything else). The prototype's
Quoted, Flagged and Discretionary each describe a record the product does not have — a quote, a flag,
a project that is not a replacement — and are left out until something produces them.

An estimated item's range, as PRD F2 asks, is in the note: `estimated · 2027–2030`. The bar stays
at the point estimate. **The range is a fifth of the item's life either side of its year, and at
least one** (#111): the seed puts an unaudited item 60% through its life, so the error in that
guess scales with the life — a year either way for a detector, four for a roof. It folds like the
bar, with no end before this year, and moves with a deferral; an item so far past due that the
whole window is behind us has none.

**`What if?`** is PRD F3's sensitivity: `Defer 1 year`, `Defer 2 years`, `Defer 3 years`. Choosing
one adds it to `?defer={itemId}:{years}`, and the chart, the figures and the reserve projection
recompute on the server with the item moved. A bar above the chart says what is being shown —
`Showing 1 change: Roof, Sumner St → 2030` — with `Clear`. A deferral answers "what if", and is not
saved until somebody decides: **`Save as plan for {year}`** makes it the item's plan (#96), and
**`Clear plan`** gives a plan up. A planned item's next replacement lands in its planned year, and
its note leads with both years — `planned for 2028 · projected 2026 · 30 yr life · …` — so the
decision is shown beside the arithmetic it overrode.

### Reserve projection

The rail. A `Card` headed `Reserve projection`, projecting the org's reserve forward to its lowest
point in the ten years.

| Line | Content |
| --- | --- |
| **Balance** | The reserve today, and `as of {date}` beneath |
| **Contributions to {year}** | `DeltaValue`, positive |
| **Replacements through {year}** | `DeltaValue`, negative |
| **Lowest point, {year}** | `DeltaValue`, under a rule — the shortfall when negative, and `--status-danger` then |

Then one sentence stating what makes that year the low point — `2028 is the low point: the Sumner
roof and the Rowan Court furnace land that year.` — its two largest items, by name. `Update reserve`
opens a `Modal` with the balance, its as-of date and the monthly contribution. All three are
required and saved together, because the schema stores a reserve whole or not at all; the date
defaults to today and cannot be later than today, and a contribution of `$0` is accepted.

The prototype's sentence goes on to recommend pulling the roof into 2027. That is advice, which is
F8's to give with its inputs shown, and it is dropped here. The prototype's `See the tax effect →`
link returns with F4, to `/tax?year={year}`.

**The reserve is the org's, not a building's**, settled by #92, because a small landlord keeps one
reserve account rather than one per building. So with a building selected, the rail says so rather
than inventing a share:
`The reserve is held across the portfolio. Choose All buildings to see its projection.`

---

## As built

#112 built this screen. What it settled that the regions above do not say:

- **Across the portfolio, "today" is the latest of the buildings' todays** (`forecastToday` in
  `src/lib/forecast/params.ts`). An org has no timezone, and on the night the year turns in one
  building and not another, a replacement due in the new year is due somewhere already. With a
  building selected it is that building's today. `Update reserve` holds the as-of date to the same
  day.
- **With a building selected, the second figure is level funding** and no year is marked short,
  for the reason the rail gives: the reserve is the org's, and a building has no share of it.
- **`?defer=` is `{itemId}:{years}`, comma-separated.** Choosing a building clears it, because a
  deferral names an item and the items change with the building. `What if?` is a radio group with
  `As forecast` first, so the menu shows which deferral is applied and takes it back; only an item's
  next replacement offers it, since the ones after follow it.
- **A selected or short year tints its estimated segment too** — the dashed border in the state's
  colour over a pale fill — or a year resting wholly on estimates could show neither.
- **The low-point sentence names items as `Roof at Sumner St`.** The example's `the Sumner roof`
  lowercases a label, which an `AC condenser` does not survive; past two items it adds
  `with {n} more items`.
- **The year's table folds on its own width, 36rem**, not at `md`: beside the rail at 1024px the
  column is 347px, narrower than a phone.

#96 added plans, and settled:

- **`Save as plan` saves the year the chart is showing**, deferral and all, and takes the deferral
  out of the URL, since the saved forecast now shows the same thing. It is offered only while a
  deferral is applied. **`Clear plan`** is offered on a planned item with no deferral applied, and
  the radio group's first choice reads `As planned` there. A deferral on a planned item moves it
  from the planned year.
- **A planned year has no estimate window.** The year is a decision, not a guess. The item's
  confidence still decides which half of the bar its cost stacks in, because that rests on the
  install year.
- **A plan for a year already gone folds into this year as Overdue**, measured from the planned
  year: it was not kept.
- **The `Planned` tag is unchanged.** It still means "not due, overdue or big ticket". A plan shows
  in the note, and the chart has no separate mark for one yet.

---

## Changes from the prototype

- **The chart's binary is "reserve runs short"**, not "over $30k", and bars split audited from
  estimated.
- **Three of seven tags are dropped** until a record backs them.
- **The advice sentence is dropped**; the factual half stays.
- **Sensitivity is new** — PRD F3 lists it and the prototype does not draw it.
- **A building filter is new.** The prototype's forecast is portfolio-only.

---

## Narrow viewports

- **Below `lg`** the reserve projection follows the year's items.
- **Below `sm`** the chart keeps all ten bars — about 24px each at 320px — drops the totals above
  them, and labels years `'26` rather than `2026`. The selected year's total is in the heading
  directly below, so nothing is lost but repetition.
- The three figures stack into label-and-figure rows below `sm`. They are not `StatTile`s — each is
  the chart beneath it summed, so there is nowhere for one to link.

---

## States

| State | What renders |
| --- | --- |
| **No capital items** | One `EmptyState` in place of the whole page body: `Nothing to forecast yet` / `The forecast is built from equipment. Add it to a building and each replacement lands here.` / `Go to your buildings` |
| **A year with nothing due** | The bar is empty and still selectable; the table reads `Nothing is due in {year}.` |
| **No reserve entered** | The rail's `EmptyState`: `Add your reserve` / `Enter what you have set aside and what you add each month, and this shows the years it runs short.` / `Update reserve` |
| **A deferral naming an item that no longer exists** | Dropped from the URL on render, silently — it changed nothing to show |
| **Loading** | The figures, a ten-bar skeleton, six rows, the rail card |
