# Product Requirements Document

**Name:** CapExWise (`capexwise.com`, registered 2026-09-08)
**Status:** Draft v0.2
**Owner:** Holden
**Last updated:** 2026-09-08

---

## 1. Problem

Small residential landlords manage the *transactional* side of renting reasonably well. Zillow Rental Manager, Avail, TurboTenant and similar tools handle listings, applications, screening, leases, rent collection, and tenant messaging — mostly for free.

Almost none of them handle the *ownership* side well:

- **What is going to break, and when.** A furnace installed in 2009 is a known, dated, forecastable liability. Most landlords carry that in their head or not at all.
- **What it will cost, and whether cash will be there.** Capital expenditures arrive in lumps — a roof and an HVAC system in the same year is a five-figure event. Reserve planning is mostly guesswork.
- **What it does to the tax bill.** Whether a given spend is a deductible repair or a capitalized improvement materially changes taxable income, and the *timing* of a discretionary capital project is one of the few real levers a small landlord has.
- **The operational trivia.** Door codes, lockbox codes, trash day, which utility provider serves which unit, average monthly bills, who cleaned the gutters last year. Scattered across notes apps, texts, and memory.

The result is reactive ownership: capital spending is discovered rather than planned, and tax planning happens in March for a year that already ended.

## 2. Positioning

**This is a companion tool, not a replacement.** The assumption is that the user already runs rent collection, leases, listings, and tenant communication somewhere else — most commonly Zillow Rental Manager.

| Owned by Zillow / equivalent | Owned by this product |
|---|---|
| Listings and syndication | Capital asset inventory and lifecycle |
| Applications and screening | CapEx forecast and reserve planning |
| Lease documents and e-signature | Tax liability estimation and scenario planning |
| Rent collection and payment processing | Recurring and one-off maintenance scheduling |
| Tenant messaging | Vendor/contact book by trade |
| | Building operational facts (codes, utilities, service days) |
| | Rent roll and rent-received tracking (manual — no money moves) |

The one-line pitch: *Zillow handles the money coming in. This handles what's going to break, when, what it costs, and what it does to your taxes.*

**Integration reality.** Zillow Group publishes APIs for listing feed syndication, lead delivery, Zestimates, and public records — none of which expose a landlord's own Rental Manager data (leases, payments, tenants). There is no supported path to sync. v1 therefore assumes **manual entry**, with CSV import as a later convenience. This is a stated non-goal, not a deferred feature.

## 3. Goals

1. **Personal utility.** Replace the spreadsheets and mental accounting used to manage two Indianapolis duplexes remotely from Bloomington.
2. **Portfolio artifact.** A public repo and a live, seeded demo instance that demonstrate product ownership, multi-tenant architecture, billing, CI/CD, and test discipline.
3. **Commercial product.** A subscription tool for individual landlords and small property management groups (roughly 1–50 units).

These are not three products. They are one multi-tenant application with three kinds of organization: the owner's org, a `demo` org, and customer orgs.

## 4. Non-goals (v1)

- Rent collection or payment processing. **No money moves through this product**, and no payment method is stored. Recording whether the expected rent arrived is in scope (F1); moving it is not.
- Lease document generation, storage, or e-signature
- Listing creation or syndication
- Tenant screening or background checks
- Tenant-facing accounts, portals, or messaging
- Any automated sync with Zillow or another PM platform
- Accounting-grade bookkeeping or general ledger
- Filing taxes, or producing anything that constitutes tax advice
- Storing SSNs, full bank account numbers, or screening reports
- Mobile native apps (responsive web only)

## 5. Users

**Primary — the owner-operator.** Owns 1–10 units. Self-manages. Financially literate, spreadsheet-fluent, not an accountant. Cares most about: not being surprised by a $12,000 roof, and knowing before December what December's decisions do to April's tax bill.

**Secondary — the small management group.** 10–50 units, 2–5 people. Adds the need for shared access, task assignment, and a vendor book that isn't in one person's phone. This user drives the multi-tenancy and role requirements even though the owner-operator is the design target.

**Explicitly not a user in v1:** tenants. They never log in.

## 6. Core concepts

| Concept | Definition |
|---|---|
| **Organization** | The tenancy boundary. Owns everything. Has a plan (`free` / `premium`). |
| **Building** | A physical address. Contains one or more units — a duplex is one building and two units. Owns whatever is structurally shared: roof, gutters, siding, foundation, and usually the operational facts. |
| **Unit** | A separately-leased space within a building. Carries its own rent, lease end, and occupancy. |
| **Capital item** | A depreciating physical asset with a finite service life — furnace, roof, water heater, carpet, appliances. **Scoped to a building when it is shared** (roof, gutters) **or to a single unit when it is not** (a dishwasher, the flooring in unit B). |
| **Confidence** | Whether a capital item's install date is `estimated` (inferred from build year or a guess) or `audited` (physically confirmed by the user). Displayed differently and treated differently by the forecast. |
| **Task** | Something that needs doing. Recurring (air filter, gutters, HVAC service) or one-off. `unscheduled` or `scheduled`. Scoped to a building or a single unit, the same way a capital item is. |
| **Rent period** | One month of expected rent for one unit. Carries the amount expected *when the period opened* and whether it was received. |
| **Contact** | A vendor, tradesperson, or professional. Has one or more trade tags. |
| **Replacement event** | A projected future capital expenditure, derived from a capital item's install year plus expected service life. |

## 7. Feature areas

### F0 — Portfolio dashboard _(v1)_

The landing screen, and the surface this product is opened for. Five stat tiles above the
building cards:

- **Open tasks** — unscheduled work across every building.
- **Upcoming tasks** — scheduled work falling inside the next 30 days.
- **End-of-life warnings** — capital items at or past expected service life, with estimated
  install years flagged as estimates rather than mixed in silently.
- **Estimated tax liability** — the current-year figure from F4, carrying the same disclaimer
  it carries on its own page.
- **Cash flow** — rent received against rent expected, less recorded spend, month to date and
  year to date.

Every tile links through to the surface that owns the number, and no figure appears here that
cannot be traced by clicking it. The last two tiles are the constrained ones: the tax tile
depends on F4, and the cash flow tile depends on the rent periods in F1 plus the expense entry
settled in Open Question 5.

### F1 — Buildings & units _(v1)_

- Building list as cards: address, unit count, monthly rent roll, 12-month projected capex, tasks due, and a "systems life used" indicator.
- Building detail page as the primary workspace.
- **Building facts card:** access codes (master smart-lock, door, lockbox) masked by default with a reveal action; trash/recycling day; lawn care and snow contacts; gas, electric, water/sewer, and internet providers with account reference stubs; average monthly bill per utility with an owner-paid subtotal.
- Unit records: rent amount, lease end date, occupied/vacant. Entered manually — this is not a lease system.
- **Rent roll with a Paid checkoff.** Each occupied unit opens a monthly rent period carrying the amount expected. Marking it paid is one click; a partial or late payment records an actual amount and date. This is a record of what arrived, not a payment rail — and it is what feeds the cash flow tile (F0) and the annual income figure the tax planner needs (F4), for one click per unit per month.
- **The expected amount is snapshotted when the period opens,** never read live from the unit's current rent. A rent increase must not rewrite last year's history, or the tax page built on it.

### F2 — Capital items & lifecycle _(v1 — core differentiator)_

- Add-equipment checklist modal grouped by Kitchen / Laundry / HVAC & water / Envelope / Interior & systems. Per-group "select all."
- Each checklist item carries a default scope (building or unit), a default service life, and an estimated install year seeded from the building's build year.
- **Scope is a per-item choice, not a fixed rule.** Envelope items are building-scoped and Kitchen / Laundry / Interior finishes are unit-scoped, but HVAC & water cannot be settled by catalog group: a duplex may run separate furnaces on a shared water main, or one shared boiler. The checklist proposes; the user confirms.
- Capital items table: install year with an `ESTIMATED` (dashed) or `AUDITED` (solid) badge, age-vs-expected-life bar, projected replacement year, estimated replacement cost, status.
- A **Confirm** action flips an item to audited and prompts for the actual install date and cost.
- Estimated vs audited is not cosmetic: the forecast should widen its confidence range for estimated items and surface "audit these N items to tighten your forecast" as a prompt.

### F3 — CapEx forecast _(v1 — core differentiator)_

- 10-year projection chart, clickable by year.
- Per-year line items showing which capital items drive the number.
- Reserve projection: a monthly contribution assumption plotted against projected outflow, surfacing the years where the reserve goes negative.
- Sensitivity: what changes if a given item is deferred one, two, or three years.

### F4 — Tax planner _(v1, simplified)_

- Schedule E–shaped statement per building and portfolio-wide, populated by the rent periods from F1 plus the expense entry settled in Open Question 5.
- **Shared capital items are allocated across units by a stated, visible rule.** A roof serves every unit in the building, so its depreciable basis is split — and the split has to be inspectable on the page, like every other figure here.
- Repair-vs-improvement classification toggle per planned capital item, recomputing estimated taxable income live.
- Straight-line depreciation on capitalized improvements; the de minimis safe harbor threshold as a configurable setting.
- Timing levers: move a discretionary project between tax years and see the delta.
- **Framed as estimates throughout.** Explicit, persistent disclaimer that this is a planning aid, not tax advice, and that classifications should be confirmed with a CPA. This wording is a requirement, not a nicety.

_Deferred to v1.1:_ cost segregation, bonus depreciation on short-life property, passive activity loss limitations, multi-state.

### F5 — Maintenance & tasks _(v1)_

- Unscheduled / Scheduled tabs.
- Recurring tasks with per-task frequency, checkoff, and inline add.
- Seasonal rhythm view showing the annual cadence at a glance.
- Task detail modal: notes, date, assignee, priority, estimated cost, make-recurring toggle, and a rail of contacts matching the task's trade tag.
- Scheduled tasks carry an assignee and a confirmation state.

### F6 — Contact book _(v1)_

- Vendors with multiple trade tags, filterable.
- Trade taxonomy: handyman, general contractor, HVAC, plumber, electrician, roofer, painter, landscaper, snow removal, pest control, turnover cleaner, locksmith, chimney, appliance repair, realtor/leasing agent, property manager, CPA, attorney, inspector.
- Contacts are org-scoped and reusable across buildings.

### F7 — Quote requests _(premium, v2)_

- From an unscheduled task: select 3+ matching contacts, choose SMS or email, preview and edit an auto-drafted quote request, send.
- Requires a transactional provider (Twilio / Resend or similar) and introduces per-message cost, opt-out handling, and 10DLC registration for SMS. **Treat as its own scoping exercise.**

### F8 — AI advisor _(premium, v2)_

- Cross-references capital items near end of life against projected tax position and recommends which projects to pull forward or push back, with estimated capex impact, tax delta, and a confidence note.
- Recommendations are advisory and must show their inputs. No black-box numbers on a page that also shows tax figures.

### F9 — Accounts, orgs, plans, demo _(v1)_

- Email auth, organizations, memberships, roles (owner / member).
- Org switcher; org context resolved server-side from session only.
- `plan` column driving a `can(org, feature)` gate. Three tiers: **free** (one unit), **paid** ($5 per unit per month), **premium** (paid, plus F7 and F8).
- **The free unit is per account, not per org.** Opening five orgs to collect five free units is a minute of work, so the allowance is checked against the owner rather than the org.
- Seeded `demo` org with fictional data, resetting nightly. The demo needs no account, which is what makes a card-free free tier workable — evaluation happens before sign-up rather than during it.
- The plan gate ships in **v0** so the seam exists; Stripe subscription billing ships in **v1**, per the release plan in section 8.

## 8. Release plan

| Release | Contents | Definition of done |
|---|---|---|
| **v0 — Personal** | F0, F1, F2, F3, F5, F6, F9 (auth + orgs, no billing) | Holden's two duplexes and four units fully entered, rent tracked monthly; the forecast is trusted enough to act on |
| **v0.5 — Demo** | Seeded demo org, public URL, public repo, README with architecture notes | A recruiter can click a link and understand the product in 90 seconds |
| **v1 — Paid** | F4, Stripe billing, onboarding flow | First non-Holden org completes setup unassisted |
| **v2 — Premium** | F7, F8 | — |

## 9. Success criteria

- **Goal 1:** Holden stops maintaining the rental spreadsheet. Capital decisions for the following year are made in Q4 using the forecast.
- **Goal 2:** The repo and demo are referenced in at least three interviews and generate substantive technical discussion (multi-tenancy, forecasting model, tax logic).
- **Goal 3:** Three paying organizations. Meaningful only if at least one was not a personal referral.

## 10. Data model sketch

**This is a sketch. [`docs/data-model.md`](data-model.md) is the real thing** — column types,
constraints, indexes, deletion behaviour per table, and the RLS policy template. Where the two
disagree, the data model document wins.

```
organizations (id, name, plan, is_demo)
users (id, email)
memberships (user_id, org_id, role)

buildings (id, org_id, address, build_year, ...)
building_facts (building_id, trash_day, providers…, avg_bills…, codes… )
units (id, org_id, building_id, rent, lease_end, status)

rent_periods (id, org_id, unit_id, period_month, amount_expected,
              amount_received, received_on)

capital_items (id, org_id, building_id, unit_id?, type, install_year,
               confidence, expected_life_years, replacement_cost)
capital_item_types (slug, group, default_scope, default_life_years, default_cost)

tasks (id, org_id, building_id, unit_id?, title, trade_tag, status,
       due_date, assignee_contact_id, recurrence, priority, est_cost)

contacts (id, org_id, name, phone, email, notes)
contact_tags (contact_id, tag)

transactions (id, org_id, building_id, unit_id?, date, amount,
              schedule_e_category, classification)
```

Every domain table carries `org_id`, and every index leads with it.

`unit_id?` is nullable, and **null means the row belongs to the whole building** — the roof and
the gutter cleaning are not unit B's. That one column is what lets a duplex be two rentals sharing
an envelope rather than two unrelated addresses, and it is why F2 asks for scope at add time and
F4 has an allocation rule.

`rent_periods.amount_expected` is a snapshot taken when the period opens, not a foreign key to
`units.rent`. Rent changes; last year's Schedule E does not.

## 11. Constraints & risks

- **No Zillow integration path.** Manual entry is a real onboarding cost and the most likely reason a trial user churns. Onboarding speed is a first-class design problem, not a polish item.
- **Tax logic is the highest-risk surface.** Wrong numbers on a tax page are worse than no tax page. Every figure needs to be traceable to its inputs, and the disclaimer needs to be unmissable.
- **PII custody.** Once other landlords' data is in the system, this is a data-processing relationship. Do not store SSNs, full bank details, or screening reports. Access codes are sensitive and should be encrypted at rest and masked by default.
- **Shared-cost allocation is part of the tax surface.** A roof serves every unit in a building, so its depreciable basis has to be split by a rule the user can see and check. An implicit or undocumented split is the same class of failure as a wrong number.
- **Cost estimates go stale.** Replacement costs vary by region and year. Defaults need a visible "last updated" and must be user-overridable.
- **Single-developer bus factor** on a product other people would depend on for planning.

## 12. Open questions

1. **Trademark clearance on "CapExWise"** (#3). Settled: **clear as of 2026-09-08.** The name and domain were already settled; the search against existing marks came back with nothing on the exact string, nothing confusingly similar, and no unregistered common-law user. It no longer gates the Vercel project (#32) or the repo going public at v0.5. Registration itself stays deferred — see #3 for the triggers.
2. **Pricing shape.** Settled: **$5 per unit per month.** Per-unit attaches the price to the customer's own revenue rather than to our cost, which is the axis worth scaling on, and the small-landlord penalty it used to carry is removed by the free unit in question 3. Two shape questions are deliberately left to the billing work rather than fixed here: a per-unit taper above roughly ten units, where a linear price starts colliding with full property-management software that also collects rent; and an annual plan, since the tax planner's payoff is annual and the billing period should be able to match it.
3. **Free tier or trial?** Settled: **the first unit is free permanently, with no card, and there is no trial.** A trial is the wrong instrument here — the tax planner is a tax-year instrument and the forecast a ten-year one, so any clock short enough to convert expires before either has paid off, and it would run during manual entry, which is the most expensive part of onboarding (F10). The free tier *is* the trial. It meters on the same unit billing meters on, so it needs no feature matrix; it gates by capacity rather than by feature, so the forecast is never hidden behind the paywall it exists to justify; and the conversion event is the customer buying a second rental rather than a timer expiring. The funnel is demo org, then a free single unit, then paid at unit two.
4. **How opinionated should default service lives be?** Settled: **national defaults, user-overridable.** Regional variance is real, but the fix is correcting the item rather than a question at signup — climate-zone selection is a step F10 doesn't need, and onboarding speed is already a first-class design problem (#39). The `capital_item_types` seed (#109) ships one national default per item type, each carrying a visible `defaults_updated_at`. **The override is per item, not per org** (2026-09-16): a default is copied onto the item when it is added and edited there ([data-model §5](data-model.md)). A per-org override of the catalogue is dropped — it would add a table and a settings screen to save retyping a figure that is corrected once per item anyway.
5. **Does v1 need expense entry?** Settled: **yes.** Rent periods (F1) already give money-in; without money-out the cash flow tile (F0) is half a number and the Schedule E statement (F4) runs on assumptions rather than on records. `transactions` is fully specified in [`data-model.md`](data-model.md) §6, so this is a scope decision rather than a design one and the migration ships in v1 with the feature. It remains the largest single scope item in v1, and it adds a screen the prototype never drew (#12).
6. **How deep does portfolio-level forecasting go?** Settled: **the full v1 scope, portfolio view included.** The dashboard rollup (F0) was already settled as the v1 landing screen; the 10-year forecast and the reserve projection get the same portfolio view in v1 rather than staying per-building until v1.1.
