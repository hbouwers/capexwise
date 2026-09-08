import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

export const metadata: Metadata = {
  title: "Styleguide — CapExWise",
  description:
    "Every design token and primitive state on one page, so drift is visible.",
};

/* ── page furniture ─────────────────────────────────────────────────────── */

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-8">
      <h2 className="text-lg font-semibold tracking-tight text-text-primary">
        {title}
      </h2>
      <p className="mt-1 max-w-2xl text-xs leading-normal text-text-tertiary">
        {note}
      </p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** The uppercase mono micro-label. 59 uses in the prototype. */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="field-label">{children}</span>;
}

/**
 * A colour chip that reads its own computed value out of the DOM would be a
 * client component; instead the hex is passed in and the swatch is painted from
 * the token, so a mismatch between the two is what the page is for.
 */
function Swatch({
  token,
  hex,
  note,
  className,
}: {
  token: string;
  hex: string;
  note?: string;
  className: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`size-10 shrink-0 rounded-md border border-border-card ${className}`}
      />
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-text-secondary">
          {token}
        </div>
        <div className="numeric text-2xs text-text-muted">{hex}</div>
        {note ? (
          <div className="mt-0.5 text-2xs text-text-muted">{note}</div>
        ) : null}
      </div>
    </div>
  );
}

function SwatchGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {children}
    </div>
  );
}

/** A status foreground on its own tint — never on an arbitrary background. */
function StatusPair({
  label,
  className,
  ratio,
}: {
  label: string;
  className: string;
  ratio: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`rounded-sm px-2 py-[3px] font-mono text-micro font-medium tracking-label uppercase ${className}`}
      >
        {label}
      </span>
      <span className="numeric text-2xs text-text-muted">{ratio}:1</span>
    </div>
  );
}

/* ── the page ───────────────────────────────────────────────────────────── */

export default function Styleguide() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-10">
        <FieldLabel>Internal</FieldLabel>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-text-primary">
          Styleguide
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-normal text-text-secondary">
          Every token in{" "}
          <code className="numeric text-xs">docs/ui/tokens.md</code> and every
          state of the primitives in{" "}
          <code className="numeric text-xs">docs/ui/components.md</code> §5,
          rendered once. Nothing here is a product surface — it exists so that a
          value drifting away from the documents is visible rather than
          discovered on a screen six months from now.
        </p>
      </header>

      <div className="flex flex-col gap-12">
        <Section
          id="text"
          title="Text colour"
          note="The only four values allowed on text. tokens.md §2 cut three light greys down to one: the prototype's two most-used text colours failed AA, and they carried most of its text. Contrast is measured against the page, then the card."
        >
          <SwatchGrid>
            <Swatch
              token="--text-primary"
              hex="#1c1a17"
              note="16.50 / 17.36"
              className="bg-text-primary"
            />
            <Swatch
              token="--text-secondary"
              hex="#4a463f"
              note="8.91 / 9.38"
              className="bg-text-secondary"
            />
            <Swatch
              token="--text-tertiary"
              hex="#6b665e"
              note="5.41 / 5.70"
              className="bg-text-tertiary"
            />
            <Swatch
              token="--text-muted"
              hex="#78726a"
              note="4.52 / 4.76 — replaces #8b857b, #a09a90, #b3ada2"
              className="bg-text-muted"
            />
            <Swatch
              token="--text-disabled"
              hex="#8b857b"
              note="disabled controls only, WCAG 1.4.3 exempt"
              className="bg-text-disabled"
            />
            <Swatch
              token="--text-on-accent"
              hex="#ffffff"
              note="7.79 on the accent"
              className="bg-text-on-accent"
            />
          </SwatchGrid>
          <div className="mt-6 flex flex-col gap-1.5">
            <p className="text-sm text-text-primary">
              Primary — the figure itself, and the name of the thing.
            </p>
            <p className="text-sm text-text-secondary">
              Secondary — body copy and row labels.
            </p>
            <p className="text-sm text-text-tertiary">
              Tertiary — supporting metadata under a value.
            </p>
            <p className="text-sm text-text-muted">
              Muted — the micro-labels above every figure, darkened from the
              prototype so they can be read.
            </p>
          </div>
        </Section>

        <Section
          id="surfaces"
          title="Surfaces and borders"
          note="Four surfaces within 5% luminance of each other. Hierarchy is carried by 1px borders, not shadow — which is why the whole set reads at these sizes, and why adding an elevation token would not help."
        >
          <SwatchGrid>
            <Swatch
              token="--surface-page"
              hex="#faf9f7"
              className="bg-surface-page"
            />
            <Swatch
              token="--surface-card"
              hex="#ffffff"
              className="bg-surface-card"
            />
            <Swatch
              token="--surface-subtle"
              hex="#fcfbf9"
              note="alternating rows, nested panels"
              className="bg-surface-subtle"
            />
            <Swatch
              token="--surface-fill"
              hex="#f4f2ee"
              note="chips, progress tracks, hover"
              className="bg-surface-fill"
            />
            <Swatch
              token="--surface-fill-strong"
              hex="#ece8e0"
              note="avatars, empty chart segments"
              className="bg-surface-fill-strong"
            />
            <Swatch
              token="--surface-overlay"
              hex="rgb(28 26 23 / .32)"
              note="modal scrim"
              className="bg-surface-overlay"
            />
          </SwatchGrid>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ["--border-card", "#eae6df", "border-border-card"],
                ["--border-divider", "#f6f4f0", "border-border-divider"],
                ["--border-section", "#f0ece5", "border-border-section"],
                ["--border-control", "#94908b", "border-border-control"],
                ["--border-modal", "#e2ded6", "border-border-modal"],
                ["--border-hover", "#c9c3b9", "border-border-hover"],
              ] as const
            ).map(([token, hex, cls]) => (
              <div
                key={token}
                className={`rounded-md border bg-surface-card p-3 ${cls}`}
              >
                <div className="text-xs font-medium text-text-secondary">
                  {token}
                </div>
                <div className="numeric text-2xs text-text-muted">{hex}</div>
              </div>
            ))}
            <div className="estimated-border rounded-md bg-surface-card p-3">
              <div className="text-xs font-medium text-text-secondary">
                --border-estimated
              </div>
              <div className="numeric text-2xs text-text-muted">
                #d8d3ca, dashed, 1.5px
              </div>
            </div>
          </div>
        </Section>

        <Section
          id="accent"
          title="Accent"
          note="A deep pine green, and the only saturated hue in the palette besides the amber/rust status pair. There is no blue and no pure grey; Tailwind's default palette is cleared so that introducing one is a change somebody has to make on purpose."
        >
          <SwatchGrid>
            <Swatch
              token="--accent"
              hex="#1f5c4d"
              note="7.40 / 7.79"
              className="bg-accent"
            />
            <Swatch
              token="--accent-hover"
              hex="#164034"
              className="bg-accent-hover"
            />
            <Swatch
              token="--accent-fill"
              hex="#f6faf8"
              note="selected chip, active toggle"
              className="bg-accent-fill"
            />
            <Swatch
              token="--accent-border"
              hex="#cfe0d8"
              className="bg-accent-border"
            />
            <Swatch
              token="--accent-quoted"
              hex="#f1f5f3"
              note="the Quoted tag fill"
              className="bg-accent-quoted"
            />
          </SwatchGrid>
        </Section>

        <Section
          id="status"
          title="Status"
          note="Every pairing is a foreground plus its own tint. Mixing a foreground with another status's tint breaks the measured contrast, which is why they are rendered here together and never apart. Colour is never the only carrier: each of these renders its label as text."
        >
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <StatusPair
              label="Overdue"
              ratio="7.35"
              className="bg-tint-overdue text-status-overdue"
            />
            <StatusPair
              label="Due"
              ratio="5.32"
              className="bg-tint-danger text-status-danger"
            />
            <StatusPair
              label="Flagged"
              ratio="5.32"
              className="bg-tint-danger text-status-danger"
            />
            <StatusPair
              label="Big ticket"
              ratio="4.85"
              className="bg-tint-warning text-status-warning"
            />
            <StatusPair
              label="Quoted"
              ratio="7.79"
              className="bg-accent-quoted text-accent"
            />
            <StatusPair
              label="Planned"
              ratio="5.09"
              className="bg-tint-neutral text-status-neutral"
            />
            <StatusPair
              label="Good"
              ratio="5.49"
              className="bg-tint-good text-status-good"
            />
          </div>
          <p className="mt-4 max-w-2xl text-xs leading-normal text-text-tertiary">
            Seven labels, five variants. components.md §9 collapses{" "}
            <em>Discretionary</em> onto <em>Planned</em>: they shared a tint and
            differed only in a text colour that failed AA, so distinguishing
            them is a wording job rather than a colour one.
          </p>
        </Section>

        <Section
          id="charts"
          title="Chart and meter colours"
          note="Bar length is the primary encoding and colour is secondary, which is what keeps the low heat step acceptable against its track. A chart that ever encodes a value in colour alone needs a different scale."
        >
          <div className="flex flex-wrap items-end gap-2">
            {(
              [
                ["heat-0", "none", "bg-heat-0", "h-6"],
                ["heat-1", "low", "bg-heat-1", "h-10"],
                ["heat-2", "moderate", "bg-heat-2", "h-16"],
                ["heat-3", "high", "bg-heat-3", "h-24"],
                ["heat-4", "highest", "bg-heat-4", "h-32"],
              ] as const
            ).map(([token, meaning, bg, h]) => (
              <div key={token} className="flex flex-col items-center gap-1.5">
                <div className={`w-16 rounded-t-sm ${bg} ${h}`} />
                <div className="numeric text-2xs text-text-muted">{token}</div>
                <div className="text-2xs text-text-tertiary">{meaning}</div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex max-w-md flex-col gap-4">
            {(
              [
                ["Reserve health", 38, "bg-meter-good"],
                ["Systems life", 63, "bg-meter-warn"],
                ["Deferred work", 88, "bg-meter-bad"],
              ] as const
            ).map(([label, pct, bg]) => (
              <div key={label}>
                <div className="flex items-baseline justify-between">
                  <FieldLabel>{label}</FieldLabel>
                  <span className="numeric text-2xs text-text-secondary">
                    {pct}%
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-meter-track">
                  <div
                    className={`h-full ${bg}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 max-w-2xl text-xs leading-normal text-text-tertiary">
            The percentage is always rendered beside the bar. The thresholds
            behind good / warn / bad are forecast logic (PRD F3), not tokens —
            these are placeholders showing that all three colours exist.
          </p>
        </Section>

        <Section
          id="type"
          title="Type scale"
          note="Nine steps, every one rounded up to a whole pixel from the prototype's half-pixel values. Tailwind's own scale is cleared, so a size outside the nine does not generate at all."
        >
          <div className="flex flex-col gap-3">
            {(
              [
                ["text-micro", "10px", "uppercase mono labels; badge text"],
                ["text-2xs", "11px", "dense table metadata, chart axis labels"],
                [
                  "text-xs",
                  "12px",
                  "secondary body, card subtitles, helper text",
                ],
                ["text-sm", "13px", "default body, table cells, nav items"],
                ["text-md", "14px", "card headings, emphasised rows"],
                ["text-lg", "16px", "page title in the header bar"],
                ["text-xl", "21px", "building name on the detail header"],
                ["text-2xl", "25px", "KPI figures"],
                [
                  "text-3xl",
                  "42px",
                  "the single hero figure on the tax screen",
                ],
              ] as const
            ).map(([cls, px, use]) => (
              <div
                key={cls}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border-divider pb-3"
              >
                <span className="numeric w-24 shrink-0 text-2xs text-text-muted">
                  {cls}
                </span>
                <span className="numeric w-12 shrink-0 text-2xs text-text-muted">
                  {px}
                </span>
                <span className={`${cls} leading-tight text-text-primary`}>
                  Furnace replacement 2031
                </span>
                <span className="text-2xs text-text-tertiary">{use}</span>
              </div>
            ))}
          </div>

          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div>
              <FieldLabel>Weight</FieldLabel>
              <div className="mt-2 flex flex-col gap-1">
                <span className="text-md font-normal text-text-primary">
                  400 — body and every value
                </span>
                <span className="text-md font-medium text-text-primary">
                  500 — micro-labels, badges
                </span>
                <span className="text-md font-semibold text-text-primary">
                  600 — headings
                </span>
              </div>
            </div>
            <div>
              <FieldLabel>Leading</FieldLabel>
              <div className="mt-2 flex flex-col gap-1 text-xs text-text-secondary">
                <span className="numeric">none 1</span>
                <span className="numeric">tight 1.2</span>
                <span className="numeric">snug 1.35</span>
                <span className="numeric">normal 1.5</span>
                <span className="numeric">relaxed 1.65</span>
              </div>
            </div>
            <div>
              <FieldLabel>Tracking</FieldLabel>
              <div className="mt-2 flex flex-col gap-1 text-xs text-text-secondary">
                <span className="tracking-tight">tight −0.02em</span>
                <span className="tracking-normal">normal 0</span>
                <span className="field-label">label 0.12em</span>
              </div>
            </div>
          </div>
        </Section>

        <Section
          id="mono"
          title="The mono rule"
          note="Every number that is a value renders in IBM Plex Mono; a number inside a sentence stays in the sentence's font. The prototype applies this without exception across all six screens, and it is why a dense financial table reads as a table rather than as prose."
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Correct</CardTitle>
                <CardDescription>
                  The value is mono; the sentence is not.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldLabel>Capex 12 mo</FieldLabel>
                <div className="numeric mt-2 text-2xl font-normal text-text-primary">
                  $39,700
                </div>
                <p className="mt-3 text-xs leading-normal text-text-secondary">
                  Built in 1912, acquired June 2019, with 4 units on a 25 yr
                  service life.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Digits, both families</CardTitle>
                <CardDescription>
                  Plex Sans and Plex Mono share a skeleton, so the same figure
                  reads as the same figure at two widths.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline gap-3">
                    <span className="numeric w-16 text-2xs text-text-muted">
                      mono
                    </span>
                    <span className="numeric text-xl text-text-primary">
                      0123456789 $8,400
                    </span>
                  </div>
                  <div className="flex items-baseline gap-3">
                    <span className="numeric w-16 text-2xs text-text-muted">
                      sans
                    </span>
                    <span className="text-xl text-text-primary">
                      0123456789 $8,400
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section
          id="confidence"
          title="Estimated versus audited"
          note="A six-property swap, not a colour change — and the most product-specific thing in the design. The word is the primary signal; the dashed border reinforces it. Colour and border style alone do not survive a screenshot, a print, or a colour-vision difference."
        >
          <div className="flex flex-wrap gap-4">
            <div className="rounded-lg border border-accent-border bg-surface-card p-4">
              <FieldLabel>Replace</FieldLabel>
              <div className="numeric mt-2 text-2xl text-text-primary">
                2031
              </div>
              <span className="mt-3 inline-block rounded-sm bg-tint-good px-2 py-[3px] font-mono text-micro font-medium tracking-label text-status-good uppercase">
                Audited
              </span>
            </div>
            <div className="estimated-border rounded-lg bg-surface-card p-4">
              <FieldLabel>Replace</FieldLabel>
              <div className="numeric mt-2 text-2xl text-text-muted">2031</div>
              <span className="mt-3 inline-block rounded-sm border border-border-estimated bg-surface-card px-2 py-[3px] font-mono text-micro font-medium tracking-label text-text-muted uppercase">
                Estimated
              </span>
            </div>
          </div>
          <p className="mt-4 max-w-2xl text-xs leading-normal text-text-tertiary">
            A derived figure inherits the lowest confidence of its inputs — a
            forecast built on one estimated install year is estimated. That is
            forecast logic (PRD F3); the token exists here so it can be
            expressed.
          </p>
        </Section>

        <Section
          id="radius"
          title="Radius, elevation and motion"
          note="Twelve radius values collapse to six. The design contains exactly one box-shadow and it is on modals; Tailwind's shadow scale is cleared so that reaching for shadow-md on a dropdown fails rather than drifts."
        >
          <div className="flex flex-wrap gap-4">
            {(
              [
                ["xs", "2px", "rounded-xs"],
                ["sm", "4px", "rounded-sm"],
                ["md", "6px", "rounded-md"],
                ["lg", "9px", "rounded-lg"],
                ["xl", "12px", "rounded-xl"],
                ["full", "9999px", "rounded-full"],
              ] as const
            ).map(([name, px, cls]) => (
              <div key={name} className="flex flex-col items-center gap-1.5">
                <div
                  className={`size-16 border border-border-control bg-surface-fill ${cls}`}
                />
                <span className="numeric text-2xs text-text-muted">
                  {name} {px}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-8">
            <div>
              <FieldLabel>Elevation</FieldLabel>
              <div className="mt-3 flex items-center gap-4">
                <div className="rounded-xl border border-border-modal bg-surface-card p-4 shadow-modal">
                  <span className="text-xs text-text-secondary">
                    --shadow-modal
                  </span>
                </div>
                <div className="rounded-lg border border-border-card bg-surface-card p-4">
                  <span className="text-xs text-text-secondary">
                    everything else: 1px border
                  </span>
                </div>
              </div>
            </div>
            <div>
              <FieldLabel>Motion</FieldLabel>
              <div className="mt-3 flex flex-col gap-1 text-xs text-text-secondary">
                <span className="numeric">
                  fast 120ms — colour, border, focus
                </span>
                <span className="numeric">base 180ms — disclosure, tabs</span>
                <span className="numeric">slow 240ms — modal enter, scrim</span>
                <span className="numeric">ease cubic-bezier(.2, 0, 0, 1)</span>
              </div>
            </div>
          </div>
        </Section>

        <Section
          id="layout"
          title="Layout"
          note="Two structural dimensions are tokens because they are layout facts rather than spacing. The prototype pins its content column at min-width 1240px; the PRD commits to responsive web, so the rail drops under the content below lg instead. What else reflows is #12's to specify."
        >
          <div className="flex flex-wrap gap-6">
            <div>
              <FieldLabel>Sidebar width</FieldLabel>
              <div className="mt-2 h-8 w-(--sidebar-width) rounded-md bg-surface-fill-strong" />
              <span className="numeric text-2xs text-text-muted">238px</span>
            </div>
            <div>
              <FieldLabel>Header height</FieldLabel>
              <div className="mt-2 h-(--header-height) w-32 rounded-md bg-surface-fill-strong" />
              <span className="numeric text-2xs text-text-muted">64px</span>
            </div>
          </div>

          <div className="grid-two-column mt-8">
            <div className="rounded-lg border border-border-card bg-surface-card p-5">
              <FieldLabel>Content</FieldLabel>
              <p className="mt-2 text-xs text-text-secondary">
                minmax(0, 1fr) — the column that absorbs the remaining width.
              </p>
            </div>
            <div className="rounded-lg border border-border-card bg-surface-card p-5">
              <FieldLabel>Rail</FieldLabel>
              <p className="mt-2 text-xs text-text-secondary">
                336px, fixed. Drops under the content below lg.
              </p>
            </div>
          </div>
        </Section>

        <Separator />

        <Section
          id="buttons"
          title="Button"
          note="Six variants, four sizes, and the states that matter. Tab to any of them: the focus indicator is a 2px pine outline at 2px offset, applied once in globals.css rather than per component, so it also covers components that do not exist yet."
        >
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <Button>Add building</Button>
              <Button variant="outline">Export</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Delete</Button>
              <Button variant="link">Link</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="xs">Extra small</Button>
              <Button size="sm">Small</Button>
              <Button>Default</Button>
              <Button size="lg">Large</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled>Disabled</Button>
              <Button variant="outline" disabled>
                Disabled outline
              </Button>
            </div>
          </div>
        </Section>

        <Section
          id="badge"
          title="Badge"
          note="Restyled to 10px mono at weight 500 with label tracking and a 4px radius. The installed default was a 12px sans pill; the badge is where the status vocabulary lands, so it is the primitive most worth pinning down."
        >
          <div className="flex flex-wrap items-center gap-3">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
            <Badge className="bg-tint-overdue text-status-overdue">
              Overdue
            </Badge>
            <Badge className="bg-tint-warning text-status-warning">
              Big ticket
            </Badge>
            <Badge className="bg-tint-good text-status-good">Audited</Badge>
          </div>
        </Section>

        <Section
          id="forms"
          title="Form controls"
          note="The control boundary is --border-control, the one value in the palette that clears 3:1 for something a user has to find. tokens.md §2 added it because nothing existing came close — the prototype's input border measures 1.38."
        >
          <div className="grid max-w-lg grid-cols-1 gap-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sg-address">Address</Label>
              <Input id="sg-address" placeholder="1042 N Delaware St" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sg-cost">Estimated cost</Label>
              <Input
                id="sg-cost"
                className="numeric"
                defaultValue="8400"
                inputMode="numeric"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sg-invalid">Invalid</Label>
              <Input id="sg-invalid" aria-invalid defaultValue="not a year" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sg-disabled">Disabled</Label>
              <Input id="sg-disabled" disabled defaultValue="Locked" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sg-notes">Notes</Label>
              <Textarea id="sg-notes" placeholder="What the vendor said" />
            </div>

            <div className="flex flex-col gap-2">
              <FieldLabel>Checkbox</FieldLabel>
              <div className="flex items-center gap-2">
                <Checkbox id="sg-check" defaultChecked />
                <Label htmlFor="sg-check">Make recurring</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="sg-check-2" />
                <Label htmlFor="sg-check-2">Unchecked</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="sg-check-3" disabled />
                <Label htmlFor="sg-check-3">Disabled</Label>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <FieldLabel>Radio</FieldLabel>
              <RadioGroup defaultValue="repair" className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="repair" id="sg-repair" />
                  <Label htmlFor="sg-repair">Repair</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="improvement" id="sg-improvement" />
                  <Label htmlFor="sg-improvement">Improvement</Label>
                </div>
              </RadioGroup>
            </div>
          </div>
        </Section>

        <Section
          id="table"
          title="Table"
          note="A real <table>. The prototype builds its tables from CSS grid on divs, which gives a screen reader no row or column association — on a table of money that is the difference between 'eight thousand four hundred' and 'Furnace, estimated cost, eight thousand four hundred'. Numeric columns are right-aligned and mono; header cells are the micro-label."
        >
          <div className="rounded-lg border border-border-card bg-surface-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <FieldLabel>Item</FieldLabel>
                  </TableHead>
                  <TableHead>
                    <FieldLabel>Installed</FieldLabel>
                  </TableHead>
                  <TableHead className="text-right">
                    <FieldLabel>Est. cost</FieldLabel>
                  </TableHead>
                  <TableHead>
                    <FieldLabel>Status</FieldLabel>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(
                  [
                    ["Furnace", "2009", "$8,400", "Overdue", "overdue"],
                    ["Roof", "2016", "$18,200", "Big ticket", "warning"],
                    ["Water heater", "2021", "$1,750", "Planned", "neutral"],
                  ] as const
                ).map(([item, year, cost, status, tone]) => (
                  <TableRow key={item}>
                    <TableCell className="font-medium text-text-primary">
                      {item}
                      <div className="text-2xs text-text-muted">
                        25 yr service life
                      </div>
                    </TableCell>
                    <TableCell className="numeric text-text-secondary">
                      {year}
                    </TableCell>
                    <TableCell className="numeric text-right text-text-primary">
                      {cost}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          tone === "overdue"
                            ? "bg-tint-overdue text-status-overdue"
                            : tone === "warning"
                              ? "bg-tint-warning text-status-warning"
                              : "bg-tint-neutral text-status-neutral"
                        }
                      >
                        {status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>

        <Section
          id="feedback"
          title="Progress and loading"
          note="Skeletons sit at the row height they replace: the 1px-border hierarchy makes layout shift unusually visible, so a skeleton that is the wrong size is worse here than in a design carried by shadow."
        >
          <div className="flex max-w-md flex-col gap-5">
            <Progress value={62} />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          </div>
        </Section>

        <Section
          id="cards"
          title="Card"
          note="9px is the signature radius — 31 uses in the prototype. The installed card separated itself with a ring and used a 12px radius; both are replaced, because 12px is the modal radius and separation in this design is a 1px border."
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Reserve health</CardTitle>
                <CardDescription>Banked against needed</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="numeric text-2xl text-text-primary">
                  $44,800
                </div>
                <Progress value={38} className="mt-3" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Gross rent</CardTitle>
                <CardDescription>Per month, 8 doors</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="numeric text-2xl text-text-primary">$9,150</div>
                <div className="mt-1 text-xs text-status-good">
                  <span className="numeric">+$450</span> vs last year
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Past life</CardTitle>
                <CardDescription>Across 5 buildings</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className="numeric text-2xl text-status-overdue">
                    4
                  </span>
                  <span className="text-xs text-text-muted">items overdue</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </Section>
      </div>

      <footer className="mt-16 border-t border-border-section pt-6">
        <p className="text-xs leading-normal text-text-tertiary">
          Interactive primitives that need client state — Select, Tabs, Dialog,
          DropdownMenu, Popover, Tooltip, Sonner — are installed and themed but
          not rendered here; they land on this page with the app shell (#29) and
          the screen specs (#12), which is also where the domain layer in
          components.md §6 gets built.
        </p>
      </footer>
    </main>
  );
}
