"use client";

import { PlusIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ComponentProps,
  type FormEvent,
  type ReactNode,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { toast } from "sonner";

import { Field, fieldId } from "@/components/field";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BASIS_SPLIT_METHOD_LABELS,
  type BasisSplitMethod,
  type BuildingFields,
  buildingValue,
  emptyUnitFields,
  nextUnitLabel,
  type UnitFields,
  unitField,
  validateBuilding,
} from "@/lib/building-form";
import { cn } from "@/lib/cn";
import type { FieldErrors } from "@/lib/forms";
import { createBuilding, updateBuilding } from "@/server/actions/buildings";

/**
 * The building form (`docs/ui/screens/building-form.md`), for a new building
 * and for an existing one. A page rather than a modal: it is the longest form
 * in the product, and a page gets a URL, the back button, and a reload that
 * does not throw it away.
 *
 * Every value is held as the string the person typed. `validateBuilding` —
 * the same function the server action runs — decides what each one is, runs
 * before anything is sent, and reports every problem at once. The server's
 * answer renders the same way, because it is the same function's answer.
 *
 * A failed save leaves the form exactly as it was typed, with the message at
 * the field it is about (`docs/ui/screens/README.md`, errors).
 */

/** A unit's row, with a key that outlives its position in the list. */
type Row = UnitFields & { key: string };

/** The form as it is held: what was typed, and a key for each unit's row. */
type FormState = Omit<BuildingFields, "units"> & { units: Row[] };

type Mode = { kind: "new" } | { kind: "edit"; buildingId: string };

/** Cancel's destination, and a save's: where the form was opened from. */
function homeOf(mode: Mode): string {
  return mode.kind === "new" ? "/" : `/buildings/${mode.buildingId}`;
}

/**
 * The viewer's timezone, which a new building defaults to. Read through
 * `useSyncExternalStore` because the server rendering this form has no viewer:
 * its snapshot is empty, and the browser's replaces it on hydration without a
 * mismatch. Nothing about it changes while the page is open, so there is
 * nothing to subscribe to.
 */
function subscribeToNothing() {
  return () => {};
}

function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function noTimeZone(): string {
  return "";
}

/** `America/Indiana/Indianapolis` as `America / Indiana / Indianapolis`. */
function zoneLabel(zone: string): string {
  return zone.replaceAll("_", " ").replaceAll("/", " / ");
}

/**
 * The Select's value for "no split method recorded". Radix refuses an empty
 * string as an item's value, because it uses one to mean "nothing chosen".
 */
const NO_METHOD = "not-recorded";

/** A unit row's status, in the trigger's words. Retired rows have no Select. */
const UNIT_STATUS_LABELS = {
  occupied: "Occupied",
  vacant: "Vacant",
  retired: "Retired",
} as const;

export function BuildingForm({
  mode,
  initial,
}: {
  mode: Mode;
  initial: BuildingFields;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  const [fields, setFields] = useState<FormState>(() => ({
    ...initial,
    units: initial.units.map((unit, index) => ({
      ...unit,
      key: unit.id ?? `new-${index}`,
    })),
  }));
  const rows = fields.units;
  const nextKey = useRef(initial.units.length);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [showPurchase, setShowPurchase] = useState(mode.kind === "edit");

  const viewerZone = useSyncExternalStore(
    subscribeToNothing,
    viewerTimeZone,
    noTimeZone,
  );
  const timezone = fields.timezone || viewerZone;

  const zones = useMemo(() => {
    const all = Intl.supportedValuesOf("timeZone");
    // A stored or detected zone that the list spells differently — an alias —
    // is still offered, or the Select would show nothing chosen.
    return timezone && !all.includes(timezone) ? [timezone, ...all] : all;
  }, [timezone]);

  const initialRent = useMemo(
    () => new Map(initial.units.map((unit) => [unit.id, unit.rent])),
    [initial.units],
  );

  const activeRows = rows.filter((row) => row.status !== "retired").length;

  function set<K extends Exclude<keyof FormState, "units">>(
    key: K,
    value: FormState[K],
  ) {
    setFields((current) => ({ ...current, [key]: value }));
    clearError(key);
  }

  /** A field's message goes as it is edited, and so does the form's. */
  function clearError(key: string) {
    setErrors((current) => {
      if (current[key] === undefined && current.form === undefined) {
        return current;
      }

      const next = { ...current };
      delete next[key];
      delete next.form;
      return next;
    });
  }

  function setRows(update: (current: Row[]) => Row[]) {
    setFields((current) => ({ ...current, units: update(current.units) }));
  }

  function setRow(index: number, patch: Partial<UnitFields>) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
    for (const key of Object.keys(patch)) {
      clearError(unitField(index, key as "label" | "rent" | "leaseEnd"));
    }
    clearError("units");
  }

  /**
   * An error key names a row by its position, so when a row goes every unit
   * message after it would point at the wrong row. They are dropped instead;
   * the next save puts back any that still apply.
   */
  function dropUnitErrors() {
    setErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith("units.")),
      ),
    );
  }

  function addRow() {
    const index = rows.length;
    nextKey.current += 1;

    setRows((current) => [
      ...current,
      {
        ...emptyUnitFields(nextUnitLabel(current.map((row) => row.label))),
        key: `new-${nextKey.current}`,
      },
    ]);
    clearError("units");

    // To the new row's name, which is the first thing a new unit needs.
    requestAnimationFrame(() => {
      document.getElementById(fieldId(unitField(index, "label")))?.focus();
    });
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
    dropUnitErrors();
  }

  /** To the first failing field in the order the form reads. */
  function focusFirstError() {
    requestAnimationFrame(() => {
      formRef.current
        ?.querySelector<HTMLElement>(
          '[aria-invalid="true"], [data-error-anchor]',
        )
        ?.focus();
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;

    const submission: BuildingFields = {
      ...fields,
      timezone,
      units: rows.map((row) => ({
        id: row.id,
        label: row.label,
        status: row.status,
        rent: row.rent,
        leaseEnd: row.leaseEnd,
      })),
    };

    const checked = validateBuilding(submission);
    if (!checked.ok) {
      setErrors(checked.errors);
      focusFirstError();
      return;
    }

    setErrors({});

    startTransition(async () => {
      let result;

      try {
        result =
          mode.kind === "new"
            ? await createBuilding(submission)
            : await updateBuilding(mode.buildingId, submission);
      } catch {
        setErrors({
          form: "Couldn’t save the building. Check your connection and try again — what you typed is still here.",
        });
        focusFirstError();
        return;
      }

      if (!result.ok) {
        setErrors(result.errors);
        focusFirstError();
        return;
      }

      // The spec's toast goes on to offer the add-equipment modal, which
      // arrives with equipment itself (#110).
      if (mode.kind === "new") toast.success("Building added.");
      router.push(`/buildings/${result.buildingId}`);
    });
  }

  const value = buildingValue(fields);

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      noValidate
      className="flex max-w-160 flex-col gap-5 [&_button]:scroll-mt-24 [&_input]:scroll-mt-24"
    >
      <Section title="Address">
        <Field
          name="label"
          label="Name"
          optional
          helper="When it has no name, the street address is its name."
          error={errors.label}
        >
          {(control) => (
            <Input
              {...control}
              value={fields.label}
              onChange={(event) => set("label", event.target.value)}
              placeholder="e.g. The Elm Street duplex"
              autoComplete="off"
            />
          )}
        </Field>

        <div className="flex flex-col gap-2">
          <Field
            name="addressLine1"
            label="Street address"
            error={errors.addressLine1}
          >
            {(control) => (
              <Input
                {...control}
                value={fields.addressLine1}
                onChange={(event) => set("addressLine1", event.target.value)}
                autoComplete="off"
              />
            )}
          </Field>
          <Input
            id={fieldId("addressLine2")}
            aria-label="Street address, second line (optional)"
            value={fields.addressLine2}
            onChange={(event) => set("addressLine2", event.target.value)}
            placeholder="Second line (optional)"
            autoComplete="off"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem_8rem] sm:gap-3">
          <Field name="city" label="City" error={errors.city}>
            {(control) => (
              <Input
                {...control}
                value={fields.city}
                onChange={(event) => set("city", event.target.value)}
                autoComplete="off"
              />
            )}
          </Field>
          <Field name="region" label="State" error={errors.region}>
            {(control) => (
              <Input
                {...control}
                value={fields.region}
                onChange={(event) => set("region", event.target.value)}
                autoComplete="off"
              />
            )}
          </Field>
          <Field name="postalCode" label="ZIP" error={errors.postalCode}>
            {(control) => (
              <Input
                {...control}
                value={fields.postalCode}
                onChange={(event) => set("postalCode", event.target.value)}
                autoComplete="off"
                className="font-mono tabular-nums"
              />
            )}
          </Field>
        </div>

        <Field
          name="timezone"
          label="Time zone"
          helper="Due dates and “today” follow the building’s clock."
          error={errors.timezone}
        >
          {(control) => (
            <Select
              // Empty until the browser says where it is: Radix reads "" as
              // nothing chosen, and stays controlled when the zone arrives.
              value={timezone}
              onValueChange={(zone) => set("timezone", zone)}
            >
              <SelectTrigger {...control} className="w-full">
                <SelectValue placeholder="Choose a time zone">
                  {timezone ? zoneLabel(timezone) : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-72">
                {zones.map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zoneLabel(zone)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      </Section>

      <Section title="The building">
        <Field
          name="buildYear"
          label="Year built"
          optional
          helper="Used to estimate how old the equipment is."
          error={errors.buildYear}
        >
          {(control) => (
            <Input
              {...control}
              value={fields.buildYear}
              onChange={(event) => set("buildYear", event.target.value)}
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              placeholder="1924"
              className="w-28 font-mono tabular-nums"
            />
          )}
        </Field>
      </Section>

      <Section title="Units">
        {errors.units ? (
          <p
            data-error-anchor
            tabIndex={-1}
            role="alert"
            className="text-xs leading-snug text-status-danger"
          >
            {errors.units}
          </p>
        ) : null}

        <ul className="flex flex-col gap-4">
          {rows.map((row, index) => (
            <UnitRow
              key={row.key}
              row={row}
              index={index}
              errors={errors}
              rentChanged={
                row.id !== null && initialRent.get(row.id) !== row.rent
              }
              removable={activeRows > 1 || row.status === "retired"}
              onChange={(patch) => setRow(index, patch)}
              onRemove={() => removeRow(index)}
            />
          ))}
        </ul>

        <div>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <PlusIcon aria-hidden />
            Add another unit
          </Button>
        </div>
      </Section>

      {showPurchase ? (
        <Section
          title="Purchase and basis"
          description="Used by the tax planner. Enter all of it or none of it."
        >
          <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
            <Field
              name="acquiredOn"
              label="Acquired on"
              error={errors.acquiredOn}
            >
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={fields.acquiredOn}
                  onChange={(event) => set("acquiredOn", event.target.value)}
                  className="font-mono tabular-nums"
                />
              )}
            </Field>
            <Field
              name="inServiceOn"
              label="Placed in service"
              helper="When it was first available to rent. Depreciation starts here. Left empty, it is the day it was acquired."
              error={errors.inServiceOn}
            >
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={fields.inServiceOn}
                  onChange={(event) => set("inServiceOn", event.target.value)}
                  className="font-mono tabular-nums"
                />
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
            <Field
              name="purchasePrice"
              label="Purchase price"
              error={errors.purchasePrice}
            >
              {(control) => (
                <MoneyInput
                  {...control}
                  value={fields.purchasePrice}
                  onChange={(event) => set("purchasePrice", event.target.value)}
                />
              )}
            </Field>
            <Field
              name="closingCosts"
              label="Capitalized closing costs"
              optional
              helper="Only the costs added to basis — not prepaid taxes, insurance or interest."
              error={errors.closingCosts}
            >
              {(control) => (
                <MoneyInput
                  {...control}
                  value={fields.closingCosts}
                  onChange={(event) => set("closingCosts", event.target.value)}
                />
              )}
            </Field>
            <Field name="landValue" label="Land value" error={errors.landValue}>
              {(control) => (
                <MoneyInput
                  {...control}
                  value={fields.landValue}
                  onChange={(event) => set("landValue", event.target.value)}
                />
              )}
            </Field>

            {/* Computed, never typed: a fourth input could disagree with the
                other three, and `buildings_basis_complete` would refuse it. */}
            <div className="flex flex-col gap-1.5">
              <span
                id="building-value-label"
                className="text-xs leading-none font-medium text-text-secondary"
              >
                Building value
              </span>
              <output
                aria-labelledby="building-value-label"
                aria-describedby="building-value-note"
                htmlFor={`${fieldId("purchasePrice")} ${fieldId("closingCosts")} ${fieldId("landValue")}`}
                className="flex h-8 items-center text-sm text-text-primary"
              >
                {value === null ? (
                  <span className="text-text-muted">—</span>
                ) : (
                  <Money cents={value} />
                )}
              </output>
              <p
                id="building-value-note"
                className="text-xs leading-snug text-text-muted"
              >
                Price plus capitalized closing costs, less land. This is the
                part that depreciates.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
            <Field
              name="basisSplitMethod"
              label="How the split was made"
              optional
              error={errors.basisSplitMethod}
            >
              {(control) => (
                <Select
                  value={fields.basisSplitMethod || NO_METHOD}
                  onValueChange={(method) =>
                    set(
                      "basisSplitMethod",
                      method === NO_METHOD ? "" : (method as BasisSplitMethod),
                    )
                  }
                >
                  <SelectTrigger {...control} className="w-full">
                    <SelectValue>
                      {fields.basisSplitMethod
                        ? BASIS_SPLIT_METHOD_LABELS[fields.basisSplitMethod]
                        : "Not recorded"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value={NO_METHOD}>Not recorded</SelectItem>
                    {Object.entries(BASIS_SPLIT_METHOD_LABELS).map(
                      ([method, label]) => (
                        <SelectItem key={method} value={method}>
                          {label}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field
              name="basisSplitNote"
              label="Source"
              optional
              error={errors.basisSplitNote}
            >
              {(control) => (
                <Input
                  {...control}
                  value={fields.basisSplitNote}
                  onChange={(event) =>
                    set("basisSplitNote", event.target.value)
                  }
                  placeholder="e.g. 2026 county assessment, 18% land"
                  autoComplete="off"
                />
              )}
            </Field>
          </div>
        </Section>
      ) : (
        <div className="flex flex-col items-start gap-1.5">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setShowPurchase(true);
              requestAnimationFrame(() =>
                document.getElementById(fieldId("acquiredOn"))?.focus(),
              );
            }}
          >
            <PlusIcon aria-hidden />
            Add purchase details
          </Button>
          <p className="text-xs leading-snug text-text-muted">
            Used by the tax planner. Enter all of it or none of it.
          </p>
        </div>
      )}

      {errors.form ? (
        <p
          data-error-anchor
          tabIndex={-1}
          role="alert"
          className="text-sm leading-normal text-status-danger"
        >
          {errors.form}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2.5 border-t border-border-card pt-5">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save building"}
        </Button>
        <Button variant="outline" asChild>
          <Link href={homeOf(mode)}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

/** One unit: its name, whether it is let, and — if it is — for what. */
function UnitRow({
  row,
  index,
  errors,
  rentChanged,
  removable,
  onChange,
  onRemove,
}: {
  row: Row;
  index: number;
  errors: FieldErrors;
  rentChanged: boolean;
  removable: boolean;
  onChange: (patch: Partial<UnitFields>) => void;
  onRemove: () => void;
}) {
  const name = row.label.trim() || `unit ${index + 1}`;
  // Column labels are visible on the first row from `sm` up and on every row
  // below it, where each unit is its own small stacked group. Every input has
  // its own label either way; the rest are only visually hidden.
  const labelClass = index === 0 ? undefined : "sm:sr-only";

  if (row.status === "retired") {
    return (
      <li className="flex items-center justify-between gap-3 rounded-md bg-surface-subtle px-3 py-2.5">
        <span className="text-sm text-text-muted">
          {row.label} <span className="text-xs">· retired</span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange({ status: "vacant" })}
        >
          Restore
        </Button>
      </li>
    );
  }

  // Rent and lease end are asked only of an occupied unit. A vacant unit
  // keeps any asking rent it had, so the value stays; it is shown again if it
  // is the reason the save failed.
  const askRent =
    row.status === "occupied" || errors[unitField(index, "rent")] !== undefined;
  const askLease =
    row.status === "occupied" ||
    errors[unitField(index, "leaseEnd")] !== undefined;

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-3 border-b border-border-divider pb-4 last:border-0 last:pb-0 sm:grid-cols-[6rem_8rem_minmax(0,1fr)_10rem_auto] sm:border-0 sm:pb-0">
      <Field
        name={unitField(index, "label")}
        label="Unit"
        labelClassName={labelClass}
        error={errors[unitField(index, "label")]}
      >
        {(control) => (
          <Input
            {...control}
            value={row.label}
            onChange={(event) => onChange({ label: event.target.value })}
            autoComplete="off"
          />
        )}
      </Field>

      <Field
        name={`units.${index}.status`}
        label="Status"
        labelClassName={labelClass}
      >
        {(control) => (
          <Select
            value={row.status}
            onValueChange={(status) =>
              onChange({ status: status as "occupied" | "vacant" })
            }
          >
            <SelectTrigger {...control} className="w-full">
              {/* Named here rather than left to Radix, which portals the
                  chosen item's text in only once the browser has mounted it —
                  so the server's HTML would show an empty trigger. */}
              <SelectValue>{UNIT_STATUS_LABELS[row.status]}</SelectValue>
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="occupied">Occupied</SelectItem>
              <SelectItem value="vacant">Vacant</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Field>

      {/* Level with the inputs rather than their labels: the labels show on
          every row below `sm` and only on the first from it. */}
      <div
        className={cn(
          "col-start-3 row-start-1 pt-4.5 sm:col-start-5",
          index !== 0 && "sm:pt-0",
        )}
      >
        {removable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            aria-label={`Remove ${name}`}
          >
            <XIcon aria-hidden />
          </Button>
        ) : (
          // Holds the column, so the last unit's fields line up with the rest.
          <span className="block size-8" aria-hidden />
        )}
      </div>

      {askRent ? (
        <Field
          name={unitField(index, "rent")}
          label="Rent / mo"
          labelClassName={labelClass}
          helper={
            rentChanged
              ? "Months already recorded keep the rent they had."
              : undefined
          }
          error={errors[unitField(index, "rent")]}
          className="col-start-1 sm:col-start-3 sm:row-start-1"
        >
          {(control) => (
            <MoneyInput
              {...control}
              value={row.rent}
              onChange={(event) => onChange({ rent: event.target.value })}
            />
          )}
        </Field>
      ) : null}

      {askLease ? (
        <Field
          name={unitField(index, "leaseEnd")}
          label="Lease ends"
          optional
          labelClassName={labelClass}
          error={errors[unitField(index, "leaseEnd")]}
          className="col-start-2 sm:col-start-4 sm:row-start-1"
        >
          {(control) => (
            <Input
              {...control}
              type="date"
              value={row.leaseEnd}
              onChange={(event) => onChange({ leaseEnd: event.target.value })}
              className="font-mono tabular-nums"
            />
          )}
        </Field>
      ) : null}
    </li>
  );
}

/** A form section: a `Card` with a heading, per the spec's layout. */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5 rounded-lg border border-border-card bg-surface-card p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-md leading-tight font-semibold text-text-primary">
          {title}
        </h2>
        {description ? (
          <p className="text-xs leading-snug text-text-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * An amount, typed as text. Not `type="number"`, which would round, drop the
 * `$` and the commas a person naturally types, and let a scroll wheel change a
 * purchase price. `parseMoney` reads it, and refuses rather than rounds.
 */
function MoneyInput(props: ComponentProps<typeof Input>) {
  return (
    <Input
      inputMode="decimal"
      autoComplete="off"
      placeholder="$0"
      {...props}
      className={cn("font-mono tabular-nums", props.className)}
    />
  );
}
