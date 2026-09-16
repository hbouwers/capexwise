"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { FooterQuestion, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CAPITAL_ITEM_GROUP_LABELS } from "@/lib/capital-items";
import { type CalendarDate, formatDate } from "@/lib/dates";
import { seedInstallYear } from "@/lib/forecast/seed";
import { formatMoney } from "@/lib/money";
import {
  addCapitalItems,
  undoAddCapitalItems,
} from "@/server/actions/capital-items";
import type { CatalogueType } from "@/server/queries/capital-items";

/** `each`, `shared`, or a unit's id — what `addCapitalItems` takes. */
type Scope = string;

type Unit = { id: string; label: string };

const SAVE_FAILED =
  "Couldn’t add the equipment. Check your connection and try again — your ticks are still here.";

function itemCount(n: number): string {
  return n === 1 ? "1 item" : `${n} items`;
}

/**
 * `Add equipment` and the checklist it opens
 * (`docs/ui/screens/modal-add-equipment.md`): tick what the building has, and
 * each type arrives with the catalogue's life and cost and an estimated install
 * year. Not in the URL — a half-ticked checklist is not something anyone links
 * to, and closing it discards it.
 *
 * **The seed shown is the seed sent.** Each type's install year is
 * `seedInstallYear` over the building's build year, computed here so the list
 * can show it, and sent with the tick so the item gets the year the person
 * saw. The life, the cost and the label are never sent: the server copies
 * them from the catalogue (#109).
 *
 * **Scope is chosen per item** on a building with more than one unit, because
 * the catalogue's proposal is only a proposal — HVAC & water is where it is
 * most often wrong. `Each unit` counts as its real number of items in the
 * footer and the button.
 *
 * Adding closes the modal and offers Undo for five seconds, which removes
 * exactly the rows that were added. A failed add keeps every tick and says so
 * in the footer: the server adds all of it or none.
 */
export function AddEquipment({
  building,
  units,
  types,
  defaultsUpdatedAt,
  tracked,
  thisYear,
  variant = "default",
}: {
  building: { id: string; name: string; buildYear: number | null };
  /** The units that are not retired, in label order. */
  units: Unit[];
  types: CatalogueType[];
  defaultsUpdatedAt: CalendarDate | null;
  /** How many active items of each type the building has, by slug. */
  tracked: Record<string, number>;
  thisYear: number;
  variant?: "default" | "outline";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState<Map<string, Scope>>(new Map());
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const multiUnit = units.length > 1;

  /** The catalogue's proposal, or the building on a single-unit one. */
  function proposedScope(type: CatalogueType): Scope {
    if (!multiUnit) return "shared";
    return type.defaultScope === "unit" ? "each" : "shared";
  }

  function rowsFor(scope: Scope): number {
    return scope === "each" ? units.length : 1;
  }

  const bySlug = new Map(types.map((type) => [type.slug, type]));
  const count = [...ticked.values()].reduce(
    (sum, scope) => sum + rowsFor(scope),
    0,
  );
  const valueCents = [...ticked.entries()].reduce(
    (sum, [slug, scope]) =>
      sum + (bySlug.get(slug)?.defaultCostCents ?? 0) * rowsFor(scope),
    0,
  );

  // The catalogue's groups in its own order: types are sorted across groups.
  const groups: { group: string; types: CatalogueType[] }[] = [];
  for (const type of types) {
    const last = groups.at(-1);
    if (last?.group === type.itemGroup) last.types.push(type);
    else groups.push({ group: type.itemGroup, types: [type] });
  }

  function reset() {
    setTicked(new Map());
    setAsking(false);
    setError(null);
  }

  function onOpenChange(next: boolean) {
    if (next || pending) return;

    if (ticked.size > 0) {
      setAsking(true);
      return;
    }

    setOpen(false);
    reset();
  }

  function discard() {
    setOpen(false);
    reset();
  }

  function tick(type: CatalogueType, checked: boolean) {
    setError(null);
    setAsking(false);
    setTicked((current) => {
      const next = new Map(current);
      if (checked) next.set(type.slug, proposedScope(type));
      else next.delete(type.slug);
      return next;
    });
  }

  function tickGroup(group: CatalogueType[], checked: boolean) {
    setError(null);
    setAsking(false);
    setTicked((current) => {
      const next = new Map(current);
      for (const type of group) {
        if (!checked) next.delete(type.slug);
        else if (!next.has(type.slug)) next.set(type.slug, proposedScope(type));
      }
      return next;
    });
  }

  function choose(slug: string, scope: Scope) {
    setTicked((current) => new Map(current).set(slug, scope));
  }

  function add() {
    if (ticked.size === 0 || pending) return;
    setError(null);

    // In the catalogue's order, so the rows are made in the order they were
    // listed.
    const items = types
      .filter((type) => ticked.has(type.slug))
      .map((type) => ({
        type: type.slug,
        scope: ticked.get(type.slug)!,
        installYear: seedInstallYear(
          type.defaultLifeYears,
          building.buildYear,
          thisYear,
        ),
      }));

    startTransition(async () => {
      const result = await addCapitalItems(building.id, { items }).catch(
        () => null,
      );

      if (result === null) {
        setError(SAVE_FAILED);
        return;
      }

      if (!result.ok) {
        setError(result.errors.form ?? SAVE_FAILED);
        return;
      }

      setOpen(false);
      reset();
      router.refresh();

      const added = result.itemIds;
      toast(`Added ${itemCount(added.length)}`, {
        duration: 5000,
        action: {
          label: "Undo",
          onClick: () => {
            void undoAddCapitalItems(building.id, added).then(
              (undone) => {
                if (!undone.ok) {
                  toast.error("Couldn’t undo. The equipment is still there.");
                } else if (undone.removed < added.length) {
                  // Some were confirmed in the seconds since, and stay.
                  toast(
                    `Removed ${itemCount(undone.removed)}. ${itemCount(added.length - undone.removed)} confirmed since stayed.`,
                  );
                }
                router.refresh();
              },
              () => toast.error("Couldn’t undo. The equipment is still there."),
            );
          },
        },
      });
    });
  }

  const description = [
    "Tick what the building has. Each item starts with a typical service life and cost, and an estimated install year — 60% of the way through its life",
    building.buildYear === null
      ? "."
      : `, and never before ${building.buildYear}.`,
    " Confirm them later, once you have read the labels.",
  ].join("");

  const footer = asking ? (
    <FooterQuestion
      question="Discard your selection?"
      detail={`${itemCount(count)} ticked will not be added.`}
      keep="Keep ticking"
      confirm="Discard"
      onKeep={() => setAsking(false)}
      onConfirm={discard}
    />
  ) : (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="flex flex-col gap-1">
        <p
          aria-live="polite"
          className="text-sm leading-tight font-medium text-text-primary"
        >
          {count === 0
            ? "Nothing ticked yet."
            : `${itemCount(count)} · ${formatMoney(valueCents)} of replacement value · all estimated`}
        </p>
        {defaultsUpdatedAt ? (
          <p className="text-xs leading-snug text-text-muted">
            Lives and costs are national defaults, last updated{" "}
            {formatDate(defaultsUpdatedAt)}.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs leading-snug text-status-danger">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button type="button" disabled={count === 0 || pending} onClick={add}>
          {pending
            ? "Adding…"
            : count === 0
              ? "Add items"
              : `Add ${itemCount(count)}`}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <Button type="button" variant={variant} onClick={() => setOpen(true)}>
        Add equipment
      </Button>
      {open ? (
        <Modal
          open
          onOpenChange={onOpenChange}
          title={`Add equipment to ${building.name}`}
          description={description}
          width="920px"
          footer={footer}
        >
          <div className="@container -mt-5 flex flex-col gap-2 pb-1">
            {groups.map(({ group, types: members }) => (
              <CatalogGroup
                key={group}
                label={CAPITAL_ITEM_GROUP_LABELS[group] ?? group}
                types={members}
                ticked={ticked}
                tracked={tracked}
                units={multiUnit ? units : []}
                seedFor={(type) =>
                  seedInstallYear(
                    type.defaultLifeYears,
                    building.buildYear,
                    thisYear,
                  )
                }
                onTick={tick}
                onTickAll={tickGroup}
                onScope={choose}
              />
            ))}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/**
 * One checklist group (`components.md` §7's `CatalogGroup`): a `<fieldset>`
 * named by its group, with `Select all` — `Clear` once every item in it is
 * ticked. The heading stays at the top of the scrolling body below `md`, so a
 * long list never loses which group it is in.
 *
 * The legend is the group's name for a screen reader, and the visible heading
 * beside `Select all` repeats it for a reader who can see; a `<legend>` itself
 * cannot be made to stick.
 */
function CatalogGroup({
  label,
  types,
  ticked,
  tracked,
  units,
  seedFor,
  onTick,
  onTickAll,
  onScope,
}: {
  label: string;
  types: CatalogueType[];
  ticked: Map<string, Scope>;
  tracked: Record<string, number>;
  /** Empty on a single-unit building, which offers no scope. */
  units: Unit[];
  seedFor: (type: CatalogueType) => number;
  onTick: (type: CatalogueType, checked: boolean) => void;
  onTickAll: (types: CatalogueType[], checked: boolean) => void;
  onScope: (slug: string, scope: Scope) => void;
}) {
  const all = types.every((type) => ticked.has(type.slug));

  return (
    <fieldset className="flex flex-col">
      <legend className="sr-only">{label}</legend>
      <div className="sticky top-0 z-10 -mx-5 flex items-center justify-between gap-3 border-b border-border-divider bg-surface-card px-5 pt-5 pb-2 md:static md:-mx-6.5 md:px-6.5">
        <span aria-hidden className="field-label">
          {label}
        </span>
        <Button
          type="button"
          variant="link"
          size="xs"
          className="px-0 text-accent"
          onClick={() => onTickAll(types, !all)}
        >
          {all ? "Clear" : "Select all"}
          <span className="sr-only"> in {label}</span>
        </Button>
      </div>
      <div className="grid gap-x-6 gap-y-3.5 pt-3.5 @lg:grid-cols-2 @3xl:grid-cols-3">
        {types.map((type) => (
          <CatalogItem
            key={type.slug}
            type={type}
            scope={ticked.get(type.slug) ?? null}
            tracked={tracked[type.slug] ?? 0}
            units={units}
            seed={seedFor(type)}
            onTick={onTick}
            onScope={onScope}
          />
        ))}
      </div>
    </fieldset>
  );
}

function CatalogItem({
  type,
  scope,
  tracked,
  units,
  seed,
  onTick,
  onScope,
}: {
  type: CatalogueType;
  /** Null while unticked. */
  scope: Scope | null;
  tracked: number;
  units: Unit[];
  seed: number;
  onTick: (type: CatalogueType, checked: boolean) => void;
  onScope: (slug: string, scope: Scope) => void;
}) {
  const id = useId();

  return (
    <div className="flex items-start gap-2.5">
      <Checkbox
        id={id}
        checked={scope !== null}
        onCheckedChange={(checked) => onTick(type, checked === true)}
        aria-describedby={`${id}-seed`}
        className="mt-0.5"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Label
          htmlFor={id}
          className="text-sm leading-tight font-medium text-text-primary"
        >
          {type.label}
        </Label>
        <p id={`${id}-seed`} className="text-2xs leading-snug text-text-muted">
          <span className="numeric">est. {seed}</span> ·{" "}
          <span className="numeric">{type.defaultLifeYears}</span> yr life ·{" "}
          <span className="numeric">{formatMoney(type.defaultCostCents)}</span>
          {tracked > 0 ? (
            <span className="text-text-tertiary"> · {tracked} tracked</span>
          ) : null}
        </p>
        {scope !== null && units.length > 0 ? (
          <Select
            value={scope}
            onValueChange={(next) => onScope(type.slug, next)}
          >
            <SelectTrigger
              size="sm"
              aria-label={`Where the ${type.label.toLowerCase()} goes`}
              className="mt-0.5 w-full max-w-48"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="each">Each unit</SelectItem>
              <SelectItem value="shared">Shared</SelectItem>
              {units.map((unit) => (
                <SelectItem key={unit.id} value={unit.id}>
                  {unit.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
    </div>
  );
}
