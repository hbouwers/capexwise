# Product Requirements Document

**Working title:** _(unnamed — see Open Questions)_
**Status:** Draft v0.1
**Owner:** Holden
**Last updated:** 2026-09-01

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
| Rent collection and payment tracking | Recurring and one-off maintenance scheduling |
| Tenant messaging | Vendor/contact book by trade |
| | Property operational facts (codes, utilities, service days) |

The one-line pitch: *Zillow handles the money coming in. This handles what's going to break, when, what it costs, and what it does to your taxes.*

**Integration reality.** Zillow Group publishes APIs for listing feed syndication, lead delivery, Zestimates, and public records — none of which expose a landlord's own Rental Manager data (leases, payments, tenants). There is no supported path to sync. v1 therefore assumes **manual entry**, with CSV import as a later convenience. This is a stated non-goal, not a deferred feature.

## 3. Goals

1. **Personal utility.** Replace the spreadsheets and mental accounting used to manage two Indianapolis duplexes remotely from Bloomington.
2. **Portfolio artifact.** A public repo and a live, seeded demo instance that demonstrate product ownership, multi-tenant architecture, billing, CI/CD, and test discipline.
3. **Commercial product.** A subscription tool for individual landlords and small property management groups (roughly 1–50 units).

These are not three products. They are one multi-tenant application with three kinds of organization: the owner's org, a `demo` org, and customer orgs.

## 4. Non-goals (v1)

- Rent collection, payment processing, or payment tracking
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
| **Property** | A physical address. May contain one or more units (e.g. a duplex). |
| **Unit** | A separately-leased space within a property. |
| **Capital item** | A depreciating physical asset with a finite service life — furnace, roof, water heater, carpet, appliances. |
| **Confidence** | Whether a capital item's install date is `estimated` (inferred from build year or a guess) or `audited` (physically confirmed by the user). Displayed differently and treated differently by the forecast. |
| **Task** | Something that needs doing. Recurring (air filter, gutters, HVAC service) or one-off. `unscheduled` or `scheduled`. |
| **Contact** | A vendor, tradesperson, or professional. Has one or more trade tags. |
| **Replacement event** | A projected future capital expenditure, derived from a capital item's install year plus expected service life. |

## 7. Feature areas

### F1 — Properties & units _(v1)_

- Property list as cards: address, unit count, monthly rent roll, 12-month projected capex, tasks due, and a "systems life used" indicator.
- Property detail page as the primary workspace.
- **Property facts card:** access codes (master smart-lock, door, lockbox) masked by default with a reveal action; trash/recycling day; lawn care and snow contacts; gas, electric, water/sewer, and internet providers with account reference stubs; average monthly bill per utility with an owner-paid subtotal.
- Basic unit records: rent amount, lease end date, occupied/vacant. Entered manually, purely for context and forecasting — not a lease system.

### F2 — Capital items & lifecycle _(v1 — core differentiator)_

- Add-equipment checklist modal grouped by Kitchen / Laundry / HVAC & water / Envelope / Interior & systems. Per-group "select all."
- Each checklist item carries a default service life and seeds an estimated install year from the property's build year.
- Capital items table: install year with an `ESTIMATED` (dashed) or `AUDITED` (solid) badge, age-vs-expected-life bar, projected replacement year, estimated replacement cost, status.
- A **Confirm** action flips an item to audited and prompts for the actual install date and cost.
- Estimated vs audited is not cosmetic: the forecast should widen its confidence range for estimated items and surface "audit these N items to tighten your forecast" as a prompt.

### F3 — CapEx forecast _(v1 — core differentiator)_

- 10-year projection chart, clickable by year.
- Per-year line items showing which capital items drive the number.
- Reserve projection: a monthly contribution assumption plotted against projected outflow, surfacing the years where the reserve goes negative.
- Sensitivity: what changes if a given item is deferred one, two, or three years.

### F4 — Tax planner _(v1, simplified)_

- Schedule E–shaped statement per property and portfolio-wide, populated by manual income and expense entry.
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
- Contacts are org-scoped and reusable across properties.

### F7 — Quote requests _(premium, v2)_

- From an unscheduled task: select 3+ matching contacts, choose SMS or email, preview and edit an auto-drafted quote request, send.
- Requires a transactional provider (Twilio / Resend or similar) and introduces per-message cost, opt-out handling, and 10DLC registration for SMS. **Treat as its own scoping exercise.**

### F8 — AI advisor _(premium, v2)_

- Cross-references capital items near end of life against projected tax position and recommends which projects to pull forward or push back, with estimated capex impact, tax delta, and a confidence note.
- Recommendations are advisory and must show their inputs. No black-box numbers on a page that also shows tax figures.

### F9 — Accounts, orgs, plans, demo _(v1)_

- Email auth, organizations, memberships, roles (owner / member).
- Org switcher; org context resolved server-side from session only.
- `plan` column driving a `can(org, feature)` gate.
- Seeded `demo` org with fictional data, resetting nightly.
- Stripe subscription billing — **v2**, but the plan gate ships in v1 so the seam exists.

## 8. Release plan

| Release | Contents | Definition of done |
|---|---|---|
| **v0 — Personal** | F1, F2, F3, F5, F6, F9 (auth + orgs, no billing) | Holden's two duplexes fully entered; the forecast is trusted enough to act on |
| **v0.5 — Demo** | Seeded demo org, public URL, public repo, README with architecture notes | A recruiter can click a link and understand the product in 90 seconds |
| **v1 — Paid** | F4, Stripe billing, onboarding flow | First non-Holden org completes setup unassisted |
| **v2 — Premium** | F7, F8 | — |

## 9. Success criteria

- **Goal 1:** Holden stops maintaining the rental spreadsheet. Capital decisions for the following year are made in Q4 using the forecast.
- **Goal 2:** The repo and demo are referenced in at least three interviews and generate substantive technical discussion (multi-tenancy, forecasting model, tax logic).
- **Goal 3:** Three paying organizations. Meaningful only if at least one was not a personal referral.

## 10. Data model sketch

```
organizations (id, name, plan, is_demo)
users (id, email)
memberships (user_id, org_id, role)

properties (id, org_id, address, build_year, ...)
property_facts (property_id, trash_day, providers…, avg_bills…, codes… )
units (id, org_id, property_id, rent, lease_end, status)

capital_items (id, org_id, property_id, type, install_year,
               confidence, expected_life_years, replacement_cost)
capital_item_types (slug, group, default_life_years, default_cost)

tasks (id, org_id, property_id, title, trade_tag, status,
       due_date, assignee_contact_id, recurrence, priority, est_cost)

contacts (id, org_id, name, phone, email, notes)
contact_tags (contact_id, tag)

transactions (id, org_id, property_id, date, amount,
              schedule_e_category, classification)
```

Every domain table carries `org_id`, and every index leads with it.

## 11. Constraints & risks

- **No Zillow integration path.** Manual entry is a real onboarding cost and the most likely reason a trial user churns. Onboarding speed is a first-class design problem, not a polish item.
- **Tax logic is the highest-risk surface.** Wrong numbers on a tax page are worse than no tax page. Every figure needs to be traceable to its inputs, and the disclaimer needs to be unmissable.
- **PII custody.** Once other landlords' data is in the system, this is a data-processing relationship. Do not store SSNs, full bank details, or screening reports. Access codes are sensitive and should be encrypted at rest and masked by default.
- **Cost estimates go stale.** Replacement costs vary by region and year. Defaults need a visible "last updated" and must be user-overridable.
- **Single-developer bus factor** on a product other people would depend on for planning.

## 12. Open questions

1. **Name.** Needed before the demo URL and repo go public.
2. **Pricing shape.** Per-unit, per-property, or flat per-org? Per-unit aligns price with value but penalizes exactly the small landlord who is the design target.
3. **Free tier or trial?** A permanent free tier at 1–2 units would help adoption and make the tester phase honest. A trial converts better.
4. **How opinionated should default service lives be?** Regional variance is real. Ship national defaults and let users override, or ask for climate zone during onboarding?
5. **Does v1 need income/expense entry at all,** or can the tax planner run on capital items plus a single annual income figure per property? The lighter version ships months earlier.
6. **Multi-property portfolio rollup** — is portfolio-level forecasting a v1 view or does per-property suffice initially?
