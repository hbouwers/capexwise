# Design tokens

**Status:** v1 — the token set to build against
**Source:** `docs/ui/reference/rental-manager.html`, extracted 2026-09-08
**Issue:** [#10](https://github.com/hbouwers/capexwise/issues/10)

First document in the UI handoff order — **tokens, then the component inventory
([#11](https://github.com/hbouwers/capexwise/issues/11)), then per-screen specs
([#12](https://github.com/hbouwers/capexwise/issues/12))**. Build against this file. Do not
sample colours out of the prototype by eye, and do not paste prototype markup into a prompt: the
prototype is 456KB and every value worth having is below.

Once `app/globals.css` exists it is the source of truth for the values and this document is the
source of truth for *why* and for which name means what. If they disagree, that is a bug in one of
them.

---

## 1. How these were derived

The prototype is a Claude Design bundle. The real markup is a JSON string inside its
`<script type="__bundler/template">` tag, with all styling as inline `style` attributes and a
handful of colour maps in the accompanying script. Every number below comes from counting actual
occurrences in that markup, not from reading it.

What that count turned up, and what it means for this document:

| Measured | Count | What was done |
| --- | --- | --- |
| Distinct hex colours | 43 | 3 are the design tool's own prop-editor options, not design. 40 real, reduced to 26 named tokens |
| Distinct `font:` shorthands | 75 | Reduced to 9 sizes × 3 weights × 5 line heights |
| Distinct font sizes | 20 | Reduced to a 9-step scale |
| Distinct `border-radius` values | 12 | Reduced to 5 |
| Distinct `padding` values | 64 | **Not tokenised at all** — see §7 |
| Distinct `gap` values | 23 | Same |
| Distinct `box-shadow` values | **1** | One token, modal-only — see §8 |

**The reduction is the work.** A prototype generated element-by-element carries per-element values;
64 distinct paddings is not 64 decisions, it is one decision made 64 times with drift. Transcribing
that drift into tokens would produce a system that cannot be applied consistently because it never
says which value is right.

Three values in the prototype are **not** design and are excluded: `#1e4b8f`, `#8a3324` and
`#3d3a35` are the alternative accent colours in the bundle's prop editor. The accent resolves as
`this.props.accentColor || "#1f5c4d"`, so `#1f5c4d` is the default and the one that was designed
around.

The prototype's data is Somerville, MA. Per `CLAUDE.md` the demo city is **Indianapolis**; that is
content, not a token, and it changes at [#34](https://github.com/hbouwers/capexwise/issues/34).

---

## 2. The accessibility finding

#10 asked whether the scale "survives an accessibility pass before locking it in." It does not, and
the failure is in the colour ramp rather than the size scale. This section is first because it
changes token *values*, and every section after it quotes the corrected ones.

Contrast measured against the two surfaces text actually sits on. WCAG 2.2 AA wants **4.5:1** for
normal text and **3:1** for UI component boundaries and meaningful graphics. None of the prototype's
text qualifies as large text (that needs 18.66px at 400, or 14px at 700; the design's largest
regular-weight body run is 13.5px).

| Prototype colour | Role in the prototype | Uses | On page `#faf9f7` | On card `#ffffff` | AA |
| --- | --- | --- | --- | --- | --- |
| `#1c1a17` | primary text | 12 | 16.50 | 17.36 | pass |
| `#4a463f` | secondary text | 32 | 8.91 | 9.38 | pass |
| `#6b665e` | tertiary text | 27 | 5.41 | 5.70 | pass |
| `#8b857b` | muted text | **62** | 3.48 | 3.66 | **fail** |
| `#a09a90` | micro-labels | **94** | 2.65 | 2.79 | **fail** |
| `#b3ada2` | faintest labels | 11 | 2.12 | 2.23 | **fail** |
| `#b07d1a` | warning text and fills | 26 | 3.44 | 3.62 | **fail** |
| `#8a6417` | warning text (badges) | 3 | 5.10 | 5.36 | pass |
| `#a34a20` | danger | 27 | 5.61 | 5.90 | pass |
| `#8a2c1f` | danger, strong | 6 | 8.11 | 8.53 | pass |
| `#2f6b4f` | success | 20 | 5.98 | 6.29 | pass |
| `#1f5c4d` | accent, links | 6 | 7.40 | 7.79 | pass |

**The two most-used colours in the entire design fail, and they carry most of its text.** `#a09a90`
is the single most frequent value in the prototype (94 occurrences), used almost entirely for the
uppercase mono micro-labels above every figure — "GROSS RENT / MO", "CAPEX 12 MO", "RESERVE". Those
labels are what make the numbers legible as anything.

Three fixes, in the order they cost anything:

**The grey ramp loses two steps.** Pushing `#a09a90` and `#b3ada2` to 4.5:1 lands them on `#77726b`
and `#76736b` — within one hex digit of each other and of a corrected `#8b857b`. Three light greys
occupy a range that AA permits one step of. So the text ramp becomes four steps, three of them
already in the design, plus exactly one new value:

| Token | Value | Page | Card | Replaces |
| --- | --- | --- | --- | --- |
| `--text-primary` | `#1c1a17` | 16.50 | 17.36 | — |
| `--text-secondary` | `#4a463f` | 8.91 | 9.38 | — |
| `--text-tertiary` | `#6b665e` | 5.41 | 5.70 | — |
| `--text-muted` | `#78726a` | 4.52 | 4.76 | `#8b857b`, `#a09a90`, `#b3ada2` |

`#8b857b`, `#a09a90` and `#b3ada2` survive as **non-text** values only — decorative dots, dividers,
placeholder-illustration fills — plus `#8b857b` for disabled control text, which WCAG 1.4.3 exempts.
They are not in the semantic set in §3 and nothing should reach for them for a label.

This darkens the micro-labels visibly. Say so plainly: **part of the design's airiness is text
nobody can read.** The proportions, the tracking and the mono treatment are what actually carry the
look, and none of them change.

**The warning colour swaps roles with one already in the palette.** The design contains two warning
tones — `#b07d1a` (fails at 3.62) used for text 26 times, and `#8a6417` (passes at 5.36) used for
badge text 3 times. Promote `#8a6417` to every warning *text* use and demote `#b07d1a` to
fills only — progress bars, chart bars, the reserve-health meter — where 3:1 against its `#f4f2ee`
track is what applies and it measures 3.24. No new colour, and the accessible one is the designer's
own.

One consequence: on the darker warning tint `#f3ead9`, `#8a6417` measures **4.49** — a rounding-edge
fail. The design has a second, lighter warning tint at `#faf3e2` where it measures 4.85. **Drop
`#f3ead9`** and let `--tint-warning` be `#faf3e2` everywhere. That is one fewer colour and the
family passes.

**Control borders need a darker value than any in the palette.** WCAG 1.4.11 wants 3:1 for the
boundary of a control the user has to find. The input border `#e0dbd3` measures **1.38** on card,
and nothing existing clears 3:1 — `#c9c3b9` reaches 1.75, `#a09a90` 2.79. So one new value:
`--border-control` `#94908b`, 3.17 on card and 3.01 on page.

This applies to the *boundary of an interactive control* — inputs, selects, the secondary button.
It does **not** apply to card borders or dividers, which are decorative separators between
non-interactive regions and are exempt. `--border-card` `#eae6df` stays at 1.24 and is fine.

Two things that are checked and correct: white on the accent `#1f5c4d` is **7.79**, so primary
buttons pass; and every status tint pairing in §3 clears 4.5:1 against its own background.

**Not fixed here, deliberately:** the chart heat scale in §11 has a low step at 1.23 against its
track. Bar *length* is the primary encoding there and colour is redundant, which is what 1.4.11
asks for. If a chart ever encodes a value in colour alone, it needs revisiting.

### The size scale

The second half of #10's question. The sizes run small — 9px to 13.5px for everything that is not a
figure — but WCAG sets no minimum font size, so there is no pass/fail to report. The judgement call
in §5 is to **round every step up to the nearest whole pixel**, which lifts the floor from 9.5px to
10px and body text from 12.5px to 13px. Roughly 4% larger overall, no change to proportion. Fixing
the ramp was the necessary change; this one is cheap and worth having.

---

## 3. Colour

Two layers. **Primitives** are the raw values with no opinion about use. **Semantics** are the names
components use. Only semantic names appear in component code — a primitive in a component is a bug,
because it makes the value unchangeable without a search.

### Primitives

```css
/* Accent — a deep pine green */
--pine-900: #164034;   /* hover / pressed */
--pine-700: #1f5c4d;   /* the accent */
--pine-200: #cfe0d8;   /* accent border on tinted surfaces */
--pine-100: #eaf1ed;   /* success / audited tint */
--pine-050: #f6faf8;   /* selected state fill */
--pine-025: #f1f5f3;   /* quoted-tag fill */

/* Warm neutral — the whole surface and text system */
--warm-950: #1c1a17;
--warm-800: #4a463f;
--warm-700: #6b665e;
--warm-600: #78726a;   /* added for contrast, see §2 */
--warm-500: #8b857b;   /* non-text only */
--warm-400: #a09a90;   /* non-text only */
--warm-350: #94908b;   /* added for contrast, control borders */
--warm-300: #b3ada2;   /* non-text only */
--warm-250: #c9c3b9;   /* hover border */
--warm-240: #cfc9be;   /* hover border, cards */
--warm-200: #d8d3ca;   /* estimated / dashed */
--warm-180: #e0dbd3;   /* control border, decorative use */
--warm-160: #e2ded6;   /* modal border */
--warm-150: #eae6df;   /* card border */
--warm-140: #ece8e0;   /* neutral fill */
--warm-130: #f0ece5;   /* divider, track */
--warm-120: #f4f2ee;   /* hover fill, track */
--warm-110: #f6f4f0;   /* hairline divider */
--warm-060: #fcfbf9;   /* subtle row */
--warm-050: #faf9f7;   /* page */
--white:    #ffffff;   /* card */

/* Status */
--green-700: #2f6b4f;  /* success */
--amber-700: #8a6417;  /* warning, text */
--amber-500: #b07d1a;  /* warning, fills only — see §2 */
--amber-100: #faf3e2;  /* warning tint */
--amber-200: #f0d9c8;  /* chart fill, high magnitude */
--rust-800:  #8a2c1f;  /* danger, strong */
--rust-600:  #a34a20;  /* danger */
--rust-100:  #fdf1e8;  /* danger tint */
--rust-050:  #fdeae6;  /* overdue tint */
```

The palette has **no blue and no pure grey.** Every neutral is warmed toward the paper background,
and the only saturated hues are the pine accent and the amber/rust status pair. Introducing a blue
or a cool grey is a design change, not a token addition.

### Semantics

```css
/* Surfaces */
--surface-page:        var(--warm-050);
--surface-card:        var(--white);
--surface-subtle:      var(--warm-060);  /* alternating rows, nested panels */
--surface-fill:        var(--warm-120);  /* chips, progress tracks, hover */
--surface-fill-strong: var(--warm-140);  /* avatars, empty chart segments */
--surface-overlay:     rgba(28, 26, 23, 0.32);  /* modal scrim */

/* Text — the only four values allowed on text */
--text-primary:   var(--warm-950);
--text-secondary: var(--warm-800);
--text-tertiary:  var(--warm-700);
--text-muted:     var(--warm-600);
--text-disabled:  var(--warm-500);  /* WCAG-exempt, disabled controls only */
--text-on-accent: var(--white);

/* Borders */
--border-card:     var(--warm-150);
--border-divider:  var(--warm-110);  /* inside a card */
--border-section:  var(--warm-130);  /* between card sections */
--border-control:  var(--warm-350);  /* inputs, selects, secondary buttons */
--border-modal:    var(--warm-160);
--border-hover:    var(--warm-250);
--border-estimated: var(--warm-200); /* the dashed border, see §10 */

/* Accent */
--accent:          var(--pine-700);
--accent-hover:    var(--pine-900);
--accent-fill:     var(--pine-050);  /* selected chip, active toggle */
--accent-border:   var(--pine-200);

/* Status — foreground, and the tint it sits on */
--status-good:        var(--green-700);
--tint-good:          var(--pine-100);
--status-warning:     var(--amber-700);
--tint-warning:       var(--amber-100);
--status-danger:      var(--rust-600);
--tint-danger:        var(--rust-100);
--status-overdue:     var(--rust-800);
--tint-overdue:       var(--rust-050);
--status-neutral:     var(--text-tertiary);
--tint-neutral:       var(--surface-fill);
```

Every status pairing is a **foreground plus its own tint**, never a foreground on an arbitrary
background. Measured: good 5.49, warning 4.85, danger 5.32, overdue 7.35, neutral 5.09. Mixing a
foreground with a tint from another status breaks that guarantee.

### Status vocabulary

The prototype's tag map is the vocabulary, and it is smaller than it looks — six labels over four
status pairs:

| Label | Semantic pair |
| --- | --- |
| Overdue | `--status-overdue` / `--tint-overdue` |
| Due, Flagged | `--status-danger` / `--tint-danger` |
| Big ticket | `--status-warning` / `--tint-warning` |
| Quoted | `--accent` / `--pine-025` |
| Planned | `--status-neutral` / `--tint-neutral` |

**Colour is never the only carrier.** Every one of these renders as a badge with its label in text.
A dot or a bar tinted by status always sits beside a written value.

---

## 4. Typography — the mono rule

This is the most characteristic thing in the design and the easiest thing to lose. It is a hard
rule, not a preference:

> **Every number renders in IBM Plex Mono. Everything else renders in the sans stack.**

"Number" means money, years, ages and remaining life, dates, percentages, counts, durations, basis
points, and identifiers. A number inside a sentence stays in the sentence's font; a number that is a
*value* — in a cell, a KPI, a badge, a chart axis, a form field — is mono. The prototype applies
this without exception across all six screens, and it is why a dense financial table reads as a
table rather than as prose.

Mono is loaded at **400, 500 and 600**. 400 for values, 500 for the uppercase micro-labels and
badges, 600 for the rare emphasised tag.

```css
--font-sans: "Helvetica Neue", Helvetica, "Segoe UI", Arial, sans-serif;
--font-mono: "IBM Plex Mono", ui-monospace, "Cascadia Mono", Menlo, monospace;
```

Anything set in `--font-sans` that displays a number gets `font-variant-numeric: tabular-nums`, so a
column of figures aligns even when it falls back.

**One thing to check early, before #11.** The mono is a webfont and renders identically everywhere.
The sans is a *system stack* whose first two entries are macOS-only, so on Windows the design has
only ever rendered in Segoe UI — meaning the prototype has never been seen as designed on the
machine it is being built on. That is free to check the moment there is a page. If Segoe UI reads
wrong at these sizes, the fallback is **IBM Plex Sans**, which pairs with the mono by construction
and costs one more family from a font already being fetched. #11 makes that call with real rendering
in front of it rather than guessing here.

---

## 5. Type scale

Nine steps, every one rounded up to a whole pixel from the prototype's half-pixel values.

| Token | Size | Replaces | Used for |
| --- | --- | --- | --- |
| `--text-micro` | 10px | 9, 9.5 | uppercase mono labels above figures; badge text |
| `--text-2xs` | 11px | 10.5, 11 | dense table metadata, chart axis labels |
| `--text-xs` | 12px | 11.5, 12 | secondary body, card subtitles, helper text |
| `--text-sm` | 13px | 12.5, 13 | **default body**, table cells, nav items |
| `--text-md` | 14px | 13.5, 14, 14.5 | card headings, emphasised rows |
| `--text-lg` | 16px | 15, 16 | page title in the header bar |
| `--text-xl` | 21px | 18, 20, 21 | building name on the detail header |
| `--text-2xl` | 25px | 22, 25 | KPI figures |
| `--text-3xl` | 42px | 42 | the single hero figure on the tax screen |

Two collapses worth flagging, because they are visible: 22px and 25px both render KPI values on
different screens and become one step; 18px, 20px and 21px all render a page-level object name and
become one. Same role, same size.

`--text-sm` at 13px is the default. If a component does not say otherwise, that is what it gets.

### Weight

Three, and no more. `400` for body and every numeric value; `500` for micro-labels, badges and
emphasised names; `600` for headings. The prototype uses nothing else.

### Line height

```css
--leading-none:    1;      /* numerics, single-line labels, badges */
--leading-tight:   1.2;    /* headings, two-line names */
--leading-snug:    1.35;   /* dense multi-line metadata */
--leading-normal:  1.5;    /* body copy */
--leading-relaxed: 1.65;   /* the tax-page explanatory prose */
```

Ten distinct line heights in the prototype collapse to five. `--leading-none` on a numeric is
deliberate: a mono figure has no descenders in `0123456789$,.%` and extra leading only loosens the
grid.

### Letter spacing

```css
--tracking-label: 0.12em;   /* uppercase mono micro-labels — always with text-transform */
--tracking-tight: -0.02em;  /* display sizes, --text-xl and up */
--tracking-normal: 0;
```

Eleven values collapse to three. `--tracking-label` is not optional on an uppercase micro-label;
uppercase mono at 10px without tracking is a solid block.

---

## 6. Radius

```css
--radius-xs:   2px;   /* nav dots, tiny indicators */
--radius-sm:   4px;   /* badges, tags, inline chips */
--radius-md:   6px;   /* buttons, inputs, selects, nav items */
--radius-lg:   9px;   /* cards — the signature radius */
--radius-xl:   12px;  /* modals */
--radius-full: 9999px; /* progress bars, avatars, dots */
```

Twelve values collapse to six. `9px` is the most common in the prototype (31 uses) and is the card
radius; `7px` and `8px` fold into it, `3px` and `5px` fold into `4px`.

shadcn derives its radii from a single `--radius` with calc offsets. Setting `--radius: 9px` yields
sm 5px, md 7px, lg 9px, xl 13px — within 1px of this scale at every step, so shadcn components land
correctly without per-component overrides.

---

## 7. Spacing — no tokens

**Tailwind's default spacing scale already is this design's spacing vocabulary.** No custom scale,
no `--space-*` tokens.

The prototype's most frequent gaps are 3, 5, 7, 8, 9, 10, 12, 13, 14, 18 and 20px; its paddings
cluster at 8–10px for controls, 13–17px for card interiors and 22–26px for large panels. Tailwind's
default scale supplies 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40 — which covers the whole
range. Every prototype value snaps to a step within **2px**, and every value that drifts by 2px
rather than 1px appears three times or fewer.

So: use `p-2`, `gap-2.5`, `px-4`. Do not invent a token to hold 13px.

**`--spacing` stays at Tailwind's 4px default.** Rescaling the base unit to match the design's
1px-resolution values would silently resize every shadcn primitive and every example copied from
Tailwind's own documentation. The design is denser than shadcn's defaults, and that density belongs
in the component layer (#11), applied to a known list of components, rather than in a global
constant that changes things nobody looked at.

Two structural dimensions **are** tokens, because they are layout facts rather than spacing:

```css
--sidebar-width: 238px;
--header-height: 64px;
```

The prototype also sets `min-width: 1240px` on the content column. That is the desktop-only
constraint the PRD's responsive-web commitment rules out, and it does not become a token. #12 owns
what replaces it.

---

## 8. Elevation

The prototype contains **exactly one** box-shadow, on modals:

```css
--shadow-modal: 0 24px 60px rgba(28, 26, 23, 0.22);
```

Every other separation in the design — cards, panels, the sticky header, the sidebar, dropdowns — is
a **1px border**. That is a design principle, and it is why the surface hierarchy reads at these
sizes: with four surfaces inside 5% of each other in luminance, a shadow would be invisible and a
border is not.

**Do not add elevation tokens.** A component that feels like it needs a shadow needs a border and a
different surface token. The single exception already exists above, and it exists because a modal
sits over a scrim rather than over a surface.

The sticky header uses `rgba(250,249,247,0.9)` with `backdrop-filter: blur(8px)` over a 1px bottom
border, not a shadow.

---

## 9. Interaction states

The prototype defines hover on five patterns and nothing else. Tokenised:

```css
--hover-fill:         var(--warm-120);  /* nav items, list rows */
--hover-fill-subtle:  var(--warm-060);  /* table rows */
--hover-border:       var(--warm-250);  /* secondary buttons, controls */
--hover-border-card:  var(--warm-240);  /* clickable cards */
--hover-accent-alpha: 0.9;              /* primary button opacity */
```

### Focus is not inherited from the prototype

The prototype's only focus rule is:

```css
input:focus, select:focus { outline: none; border-color: #1f5c4d; }
```

That removes the focus indicator and replaces it with a border-colour change. It fails WCAG 2.4.7
for anything that is not an input — buttons, links, nav items and clickable cards have no focus
style at all — and the border swap on its own is a weak indicator besides. **Do not carry this
rule forward.**

```css
--focus-ring:        var(--pine-700);
--focus-ring-width:  2px;
--focus-ring-offset: 2px;
```

Applied via `:focus-visible` on every interactive element, keeping the border change as a secondary
cue rather than the only one. `#1f5c4d` measures 7.40 against the page and 6.26 against the card
border it replaces, so the indicator clears 3:1 on both. shadcn's `--ring` maps to this.

`outline: none` without a replacement indicator does not appear anywhere in the codebase. If that is
worth enforcing, it is an ESLint or Stylelint rule, not a convention — same argument as the raw-db
rule in `CLAUDE.md`.

---

## 10. Estimated versus audited

The prototype encodes confidence as a **six-property swap**, not a colour change. This maps directly
onto ADR-0005's `confidence` enum and the nullable precise date, and it is the most product-specific
thing in the design:

| | Audited | Estimated |
| --- | --- | --- |
| Value text | `--text-primary` | `--text-muted` |
| Border style | solid | **dashed** |
| Border colour | `--accent-border` `#cfe0d8` | `--border-estimated` `#d8d3ca` |
| Badge fill | `--tint-good` `#eaf1ed` | `--surface-card` |
| Badge text | `--status-good` `#2f6b4f` | `--text-muted` |
| Badge label | `AUDITED` | `ESTIMATED` |

```css
--border-estimated: var(--warm-200);
--border-estimated-style: dashed;
--border-estimated-width: 1.5px;
```

`1.5px` rather than `1px` is deliberate in the prototype — a 1px dash at this scale reads as a
lighter solid line rather than as a dash.

Two rules that follow from the PRD's traceability requirement rather than from the prototype:

- **The badge text is the primary signal, the dashed border is reinforcement.** Colour and border
  style alone do not survive a screenshot, a print, or a colour-vision difference. The prototype
  already gets this right by always rendering the word.
- **A derived figure inherits the lowest confidence of its inputs.** A forecast built on one
  estimated install year is estimated. This is a forecast-module rule (PRD F3), noted here
  because the token exists to express it, and the tax surface is where getting it wrong is
  expensive.

---

## 11. Chart and meter colours

The prototype's bars use a four-step heat scale keyed on count or magnitude, plus the fill-only
warning value from §2:

```css
--heat-0: var(--warm-130);   /* #f0ece5 — none */
--heat-1: var(--pine-200);   /* #cfe0d8 — low */
--heat-2: var(--amber-500);  /* #b07d1a — moderate */
--heat-3: var(--rust-600);   /* #a34a20 — high */
--heat-4: var(--rust-800);   /* #8a2c1f — highest */

--meter-track: var(--surface-fill);        /* #f4f2ee */
--meter-good:  var(--status-good);
--meter-warn:  var(--amber-500);
--meter-bad:   var(--status-danger);
```

The reserve-health meter and the systems-life bars thread this at 50% and 70%: under 50% good, 50–70
warn, over 70 bad. Those thresholds are forecast logic and belong to the forecast module (PRD F3),
not here — the tokens just have to exist for all three.

**Bar length is the primary encoding and colour is secondary**, which is what keeps `--heat-1` at
1.23 against its track acceptable under WCAG 1.4.11. Any chart that encodes a value in colour alone
— a heat grid, a map — needs a scale that clears 3:1 between adjacent steps, and this one does not
qualify.

---

## 12. Dark mode

**Out of scope through v1.** Decided rather than deferred, so nobody builds half of it.

The design is a warm-paper palette. Its four surfaces sit within 5% of each other in luminance,
separation comes from 1px borders rather than shadows (§8), and the whole status system is a dark
foreground on a pale tint. Inverting that is not a transform of these tokens — the tints have no
dark equivalents, the border-based hierarchy stops working when borders are lighter than surfaces,
and the mono-numeric treatment needs different weights to hold up on a dark ground. It is a second
design, and it would need the same accessibility pass §2 just did.

**Cost of reversal: low, and it stays low.** Every value in this document is a CSS custom property
behind a semantic name, so a dark theme is a second block of assignments and no component changes.
The two things that would make it expensive are both avoided here — no component references a
primitive, and nothing encodes light-mode assumptions in a class name. Revisit when there is a user
asking, not before.

Until then the app declares `color-scheme: light` so form controls and scrollbars render light
rather than being auto-inverted by the browser into a palette nobody chose.

---

## 13. Consuming this

### Tailwind v4

Tailwind is on 4.x, which takes theme values from CSS rather than a JS config. The semantic layer
goes in `@theme` in `app/globals.css` under Tailwind's own namespaces, so the utilities generate:

```css
@theme {
  --color-surface-page: #faf9f7;
  --color-text-muted:   #78726a;
  --color-status-warning: #8a6417;
  /* … */

  --font-sans: "Helvetica Neue", Helvetica, "Segoe UI", Arial, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, "Cascadia Mono", Menlo, monospace;

  --text-micro: 10px;
  --text-2xs:   11px;
  /* … */

  --radius: 9px;
}
```

`--color-text-muted` generates `text-text-muted`, `bg-text-muted` and the rest. The stutter is ugly;
naming the token `--color-muted` to get `text-muted` is worse, because it loses which layer the name
belongs to the moment there is also a muted surface. Live with the stutter.

The primitives in §3 stay outside `@theme` as plain custom properties on `:root`, so they do not
generate a hundred unused utilities.

### shadcn/ui

shadcn components read a fixed set of variable names. They have to be assigned or every dropped-in
component renders in shadcn's default palette:

| shadcn | Assign |
| --- | --- |
| `--background` | `--surface-page` |
| `--foreground` | `--text-primary` |
| `--card`, `--popover` | `--surface-card` |
| `--card-foreground`, `--popover-foreground` | `--text-primary` |
| `--primary` | `--accent` |
| `--primary-foreground` | `--text-on-accent` |
| `--secondary` | `--surface-fill` |
| `--secondary-foreground` | `--text-secondary` |
| `--muted` | `--surface-fill` |
| `--muted-foreground` | `--text-muted` |
| `--accent` | `--accent-fill` |
| `--accent-foreground` | `--accent` |
| `--destructive` | `--status-danger` |
| `--border` | `--border-card` |
| `--input` | `--border-control` |
| `--ring` | `--focus-ring` |
| `--radius` | `9px` |

Note `--accent` means two different things: shadcn's is a *subtle hover fill*, ours is the **brand
colour**. Mapping ours onto theirs would tint every hover state deep green. This row is the one most
likely to be got wrong and it is why the mapping is written down.

The exact variable list should be confirmed against the version actually installed at
[#15](https://github.com/hbouwers/capexwise/issues/15) — shadcn has changed it before (the move to
oklch, the addition of `--chart-*` and `--sidebar-*`). The mapping above is the contract; the
spelling is verified at init.

---

## 14. What this does not settle

- **The sans family** (§4). System stack or IBM Plex Sans, decided at #11 with real rendering on
  Windows in front of it.
- **Component-level density** (#11). The design is denser than shadcn's defaults; which components
  get overridden and by how much is the component inventory's job, not a token's.
- **Mobile.** Nothing here is viewport-dependent, which is deliberate — but the type scale has not
  been looked at below 375px and #12 may need a step or two to respond.
- **Motion.** The prototype has no transitions or animations at all. That is not evidence of a
  decision; #11 should set a duration and easing pair and a `prefers-reduced-motion` rule.
- **Chart thresholds** (PRD F3). The token names exist; the numbers behind good/warn/bad are forecast
  logic.
- **Print.** The tax surface will be printed or exported
  ([#45](https://github.com/hbouwers/capexwise/issues/45)) and none of these tokens have been
  checked on white paper without backgrounds.
