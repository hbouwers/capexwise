# Task detail modal

| | |
| --- | --- |
| Opened by | `?task={id}` or `?task=new`, on `/`, `/maintenance` and `/buildings/[buildingId]` |
| Release | v0. Its quote button is v2 |
| PRD | F5 |
| Component | `TaskDetailModal`, 900px ([components §7](../components.md)) |
| Prototype | the `taskOpen` block, step 0 |

One modal for every task — unscheduled, scheduled, recurring, done — and for creating one. Opened
from a table row, the dashboard's due list, or a reminder
([#41](https://github.com/hbouwers/capexwise/issues/41)).

**It lives in the URL** so that all of those can link to it, and so the back button closes it. The
page underneath renders as normal, and reads the task on the server from the `task` param, through
the same org-scoped path as everything else — an id from the URL is only a lookup into this org's
tasks. Closing replaces the URL without the param, and focus returns to whatever opened it.

---

## Header

The task's title as the modal's heading, then a row of chips: the building with its `ScopeLabel`,
the trade as a `TradeChip`, and `added {date}`. `×` closes.

`?task=new` titles the modal `New task`, and the chips are replaced by the building and scope
fields below.

---

## Body

Two columns: the form, and a 336px rail of contacts.

### The form

| Field | Notes |
| --- | --- |
| Title | Required. `Input` |
| Building, Scope | New tasks only — a building `Select`, prefilled from the page when there is one, and a scope `Select` (`Shared` or a unit) on a multi-unit building. Fixed once created |
| Notes | `Textarea`. The prototype renders notes as static text; they are the field most worth editing |
| Date | Date input. Helper: `Leave empty to keep it unscheduled.` |
| Assignee | `Select`: `Unassigned`, then contacts with this task's trade, then `Other contacts` |
| Priority | `Select`: High, Normal, Low |
| Estimated cost | `Money` input |
| Repeats | `Select`: Once, Monthly, Every 3 months, Every 6 months, Annually, Every 2 years |
| Trade | `Select` of trades |
| Equipment | Optional `Select` of the building's capital items, for work on one of them — `tasks.capital_item_id` |

**The date sets the status.** Saving an unscheduled task with a date makes it scheduled; clearing the
date makes it unscheduled again. That is the `tasks_scheduled_has_date` constraint, and it replaces
the prototype's "Save & schedule" button with a field whose helper says what it does.

**"Self" is not an assignee yet.** The prototype offers it, and `assignee_contact_id` can only name a
contact — a [gap](README.md#gaps-these-specs-found), which the small management groups of PRD §5 need
filled for member-to-member assignment too. Until it is, the list is contacts only.

### Relevant contacts

The rail. Heading `Relevant contacts`, count `{n} tagged {trade}`, and a `DataTable` of org contacts
with the task's trade:

| Column | Content |
| --- | --- |
| Name | Name, with the rate note beneath |
| Company | Company |
| Phone | A `tel:` link |
| — | `Assign`, a button that sets the Assignee field. Nothing saves until the form does |

No trade set: `Set a trade to see matching contacts.` A trade with no contacts: `No contacts tagged
{trade}.` and an `Add a contact` link to `/contacts`.

**Quote requests** sit beneath the table when F7 ships
([the quote wizard](modal-quote-request.md)). Before that, nothing is rendered there — not a
disabled button and not an upgrade prompt for a feature that does not exist yet.

---

## Footer

Pinned. On the left, for an existing task, a `More` menu: `Mark done` and `Cancel task`. On the
right, `Close` and `Save`.

**`Mark done`** replaces the footer with a short form: completed on (today, in the building's zone)
and what it cost (the estimate, editable). In v1 it adds `Record as an expense`, on by default
whenever the cost is not zero, which creates the expense row linked to the task
([expenses.md](expenses.md)). A recurring task's next occurrence is created on completion, and the
toast says when it is due.

**`Cancel task`** sets the status to canceled, for work that will not happen. There is no delete:
a canceled task keeps its history, and the tasks tables leave it out.

---

## Changes from the prototype

- **Editable**, where the prototype shows notes, priority and cost as static text.
- **One trade** rather than several — see [maintenance.md](maintenance.md#changes-from-the-prototype).
- **The upgrade prompt is gone.** "Bulk quote requests — upgrade to enable" advertises a feature
  that is two releases away, behind a billing flow that does not exist.
- **Mark done and Cancel task are new.** The prototype has no way to finish a task from its detail.

---

## Narrow viewports

Full screen below `md` ([README](README.md#modals-below-md)). The rail follows the form, and the
fields are one column below `sm`.

---

## States

| State | What renders |
| --- | --- |
| **The task does not exist or is not this org's** | The page renders without the modal, with a line at the top of the page body: `That task wasn't found.` |
| **Unsaved changes on close** | `Close`, Escape and the scrim ask `Discard your changes?` before closing. Unchanged, they close at once |
| **Save failed** | The modal stays open with everything typed, and the footer says what did not save |
| **Loading** | The modal opens on the page's render; there is no separate spinner, because the task is read with the page |
