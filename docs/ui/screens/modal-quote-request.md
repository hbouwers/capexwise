# Quote request wizard

| | |
| --- | --- |
| Opened by | `Get quotes` in [the task modal](modal-task-detail.md#relevant-contacts), for an unscheduled task |
| Release | **v2, premium** |
| PRD | F7 |
| Component | `QuoteWizard`, inside the task modal's shell at 900px ([components §7](../components.md)) |
| Prototype | the `taskOpen` block, steps 1–3 |

Pick three or more contacts for a task's trade, compose one message, and send it to each of them.

**This spec is the least settled of the set, on purpose.** PRD F7 calls quote requests "their own
scoping exercise": a transactional provider, per-message cost, opt-out handling and SMS 10DLC
registration all sit behind the send button, and the provider is
[#37](https://github.com/hbouwers/capexwise/issues/37)'s to choose. What follows is the flow the
prototype draws, corrected where it breaks a rule already settled. Revisit it when F7 is scoped.

**Gated twice.** The `Get quotes` button renders only for an org where `can(org, 'quoteRequests')`
holds, and the server action that sends re-checks it. The wizard's step lives in the modal and not
in the URL ([components §7](../components.md)).

---

## Steps

The wizard replaces the task modal's body and footer; the task's title and chips stay in the header,
so it is always clear which task the quotes are for. A step indicator under the header reads
`1 Choose · 2 Write · 3 Sent`, with the current step as `aria-current="step"`.

### 1 — Choose

Heading `Who should quote this?` and the line `Everyone tagged {trade}. Choose at least three, so
you have something to compare.`

A `DataTable` — the Quote recipients table of [components §7](../components.md):

| Column | Priority | Content |
| --- | --- | --- |
| Choose | `control` | `Checkbox` |
| Name | `primary` | Name, with company and trades in the note line |
| Rate | `fold` | Rate note, and `last used {Mon YYYY}` |

A contact with neither a phone nor an email is listed, disabled, with `No phone or email`.

The footer: `{n} chosen` — `Choose at least three · {n} of 3` below three — then `Back` and `Write
the request` (primary), disabled below three, or below every reachable contact when the trade has
fewer (see [States](#states)).

### 2 — Write

`Sending to` and the chosen names as chips. `Send by`: **Text** or **Email**, a `SegmentedControl`
on `RadioGroup` ([components §7](../components.md)), defaulting to whichever every chosen contact
can receive; a contact the channel cannot reach is named — `Kurt Bell has no email` — and left out.
Then `Message`, a `Textarea` prefilled from the task:

> Hi — I'm looking for a quote on {task} at {building address}.
>
> {task notes}
>
> Could you send an estimate, or suggest a time to look at it?
>
> {sender's name}

Beneath it: `Each person gets their own copy. Replies come back to this task.` The footer: `Back`
and `Send {n} requests` (primary).

**The sender's name is the account's, and nothing else is filled in for them.** The prototype signs
off with a phone number it had nowhere to get; the product holds the owner's email and name from
Google and nothing more ([ADR-0004](../../adr/0004-auth-provider.md)).

### 3 — Sent

A check mark, `{n} requests sent by {channel}`, and `The task stays unscheduled until you accept a
quote.` One button, `Done`, which returns to the task modal's first view.

The prototype also promises "We will nudge anyone who has not replied in three days." Automatic
follow-up messages are a separate send on the owner's behalf, with their own cost and opt-out, and
are not promised here until F7 decides to build them.

---

## Changes from the prototype

- **The signature carries no phone number** it would have to invent.
- **Unreachable contacts are named**, not silently skipped.
- **No automatic nudges** are promised.
- **A step indicator is new.** The prototype's steps have no position.

---

## Narrow viewports

Full screen below `md`, as the task modal is. The message field takes the remaining height, and the
footer's send button stays pinned above the keyboard.

---

## States

| State | What renders |
| --- | --- |
| **Fewer than three contacts for the trade** | Step 1 lists them and says `Only {n} contacts are tagged {trade}.` with `Add a contact`. Sending to fewer than three is allowed, after that line — the minimum is advice, and a trade with two plumbers in town is real |
| **Send partly failed** | Step 3 lists who was sent to and who was not, with `Retry` for the rest. It never reports all sent when some were not |
| **Plan changed mid-wizard** | The send is refused on the server, and the step says so. Nothing is sent |
