"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import { Field, fieldId, MoneyInput } from "@/components/field";
import { FooterQuestion, Modal } from "@/components/modal";
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
  ACCESS_CODE_KIND_LABELS,
  type AccessCodeKind,
  accessCodeName,
  ACCOUNT_KINDS,
  type PaidBy,
  SERVICE_KINDS,
  UTILITY_KIND_LABELS,
  type UtilityKind,
  WEEKDAY_NAMES,
  type Weekday,
} from "@/lib/building-facts";
import {
  type AccessCodeFields,
  type BuildingFactsFields,
  codeField,
  emptyAccessCodeFields,
  emptyUtilityFields,
  type UtilityFields,
  utilityField,
  validateBuildingFacts,
} from "@/lib/building-facts-form";
import type { FieldErrors } from "@/lib/forms";
import { saveBuildingFacts } from "@/server/actions/building-facts";

/**
 * The facts card's `Edit` (`docs/ui/screens/building-detail.md`, Building
 * facts): a button, and the modal it opens with the card's groups as the
 * form's sections — Access, Services, and Utility accounts with each
 * account's average bill.
 *
 * **A code's field is always empty.** Prefilling it would mean opening every
 * code to render a form; the field says `Replace code`, and leaving it empty
 * keeps the code. What is typed into one lives in this component's state until
 * the save seals it on the server, and goes when the modal closes.
 *
 * Open state is local rather than in the URL, as `screens/README.md` has it
 * for a form's unsaved input: nobody links to a half-edited facts card. A save
 * refreshes the page, whose server render is the card's new state. Closing a
 * changed form asks first, as the contact modal does, and for its reason.
 */

export type UnitOption = { id: string; label: string };

export type ContactOption = {
  id: string;
  name: string;
  company: string | null;
  archived: boolean;
};

/** Radix refuses an empty item value, so "none" has a name of its own. */
const NONE = "none";

const PAID_BY_LABELS: Record<PaidBy, string> = {
  owner: "Owner",
  tenant: "Tenant",
};

const SAVE_FAILED =
  "Couldn’t save the building’s facts. Check your connection and try again — what you typed is still here.";

type Keyed<T> = T & { key: string };

type FormState = Omit<BuildingFactsFields, "accessCodes" | "utilities"> & {
  accessCodes: Keyed<AccessCodeFields>[];
  utilities: Keyed<UtilityFields>[];
};

function withKeys(fields: BuildingFactsFields): FormState {
  return {
    ...fields,
    accessCodes: fields.accessCodes.map((row, index) => ({
      ...row,
      key: row.id ?? `new-${index}`,
    })),
    utilities: fields.utilities.map((row, index) => ({
      ...row,
      key: row.id ?? `new-${index}`,
    })),
  };
}

/** The form as the rules and the action read it: every field, no React keys. */
function withoutKeys(state: FormState): BuildingFactsFields {
  return {
    trashDay: state.trashDay,
    recyclingDay: state.recyclingDay,
    recyclingNote: state.recyclingNote,
    accessCodes: state.accessCodes.map((row) => ({
      id: row.id,
      kind: row.kind,
      label: row.label,
      unitId: row.unitId,
      code: row.code,
    })),
    utilities: state.utilities.map((row) => ({
      id: row.id,
      kind: row.kind,
      unitId: row.unitId,
      providerName: row.providerName,
      accountRef: row.accountRef,
      paidBy: row.paidBy,
      avgMonthly: row.avgMonthly,
      contactId: row.contactId,
    })),
  };
}

export function BuildingFactsEditor({
  buildingId,
  initial,
  units,
  multiUnit,
  contacts,
}: {
  buildingId: string;
  initial: BuildingFactsFields;
  /** The units a row may be scoped to. */
  units: readonly UnitOption[];
  /** Whether to ask for a scope at all — a single-unit building does not. */
  multiUnit: boolean;
  contacts: readonly ContactOption[];
}) {
  const [opened, setOpened] = useState(0);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Edit building facts"
        onClick={() => {
          // A fresh form each time, from what the page last rendered.
          setOpened((count) => count + 1);
          setOpen(true);
        }}
      >
        Edit
      </Button>
      {open ? (
        <FactsModal
          key={opened}
          buildingId={buildingId}
          initial={initial}
          units={units}
          multiUnit={multiUnit}
          contacts={contacts}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function FactsModal({
  buildingId,
  initial,
  units,
  multiUnit,
  contacts,
  onClose,
}: {
  buildingId: string;
  initial: BuildingFactsFields;
  units: readonly UnitOption[];
  multiUnit: boolean;
  contacts: readonly ContactOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [fields, setFields] = useState<FormState>(() => withKeys(initial));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();
  const nextKey = useRef(0);

  const changed =
    JSON.stringify(withoutKeys(fields)) !== JSON.stringify(initial);

  // Every active contact, and an archived one only where a row already names
  // them: a save should not quietly unlink the plow because it was archived.
  const contactChoices = contacts.filter(
    (contact) =>
      !contact.archived ||
      initial.utilities.some((row) => row.contactId === contact.id),
  );

  function onOpenChange(next: boolean) {
    if (next || pending) return;

    if (changed) {
      setAsking(true);
      return;
    }

    onClose();
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

  function set<K extends "trashDay" | "recyclingDay" | "recyclingNote">(
    key: K,
    value: FormState[K],
  ) {
    setFields((current) => ({ ...current, [key]: value }));
    setAsking(false);
    clearError(key);
  }

  function setCode(index: number, patch: Partial<AccessCodeFields>) {
    setFields((current) => ({
      ...current,
      accessCodes: current.accessCodes.map((row, i) =>
        i === index ? { ...row, ...patch } : row,
      ),
    }));
    setAsking(false);
    for (const key of Object.keys(patch)) {
      clearError(`accessCodes.${index}.${key}`);
    }
  }

  function setUtility(index: number, patch: Partial<UtilityFields>) {
    setFields((current) => ({
      ...current,
      utilities: current.utilities.map((row, i) =>
        i === index ? { ...row, ...patch } : row,
      ),
    }));
    setAsking(false);
    for (const key of Object.keys(patch)) {
      clearError(`utilities.${index}.${key}`);
    }
    // A service is named by its company or its contact, so choosing a
    // contact answers the company's message.
    if ("contactId" in patch) clearError(utilityField(index, "providerName"));
  }

  /**
   * An error key names a row by its position, so when a row goes every
   * message after it in that list would point at the wrong row. They are
   * dropped instead; the next save puts back any that still apply.
   */
  function dropErrors(list: "accessCodes" | "utilities") {
    setErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith(`${list}.`)),
      ),
    );
  }

  function focusSoon(id: string) {
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  function addCode() {
    const index = fields.accessCodes.length;
    nextKey.current += 1;

    setFields((current) => ({
      ...current,
      accessCodes: [
        ...current.accessCodes,
        { ...emptyAccessCodeFields(), key: `added-${nextKey.current}` },
      ],
    }));
    setAsking(false);
    focusSoon(fieldId(codeField(index, "label")));
  }

  function addUtility(kind: UtilityKind) {
    const index = fields.utilities.length;
    nextKey.current += 1;

    setFields((current) => ({
      ...current,
      utilities: [
        ...current.utilities,
        { ...emptyUtilityFields(kind), key: `added-${nextKey.current}` },
      ],
    }));
    setAsking(false);
    focusSoon(fieldId(utilityField(index, "providerName")));
  }

  function removeCode(index: number) {
    setFields((current) => ({
      ...current,
      accessCodes: current.accessCodes.filter((_, i) => i !== index),
    }));
    setAsking(false);
    dropErrors("accessCodes");
  }

  function removeUtility(index: number) {
    setFields((current) => ({
      ...current,
      utilities: current.utilities.filter((_, i) => i !== index),
    }));
    setAsking(false);
    dropErrors("utilities");
  }

  function focusFirstError() {
    requestAnimationFrame(() => {
      formRef.current
        ?.closest("[role=dialog]")
        ?.querySelector<HTMLElement>(
          '[aria-invalid="true"], [data-error-anchor]',
        )
        ?.focus();
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;

    const submission = withoutKeys(fields);

    const checked = validateBuildingFacts(submission);
    if (!checked.ok) {
      setErrors(checked.errors);
      focusFirstError();
      return;
    }

    setErrors({});
    setAsking(false);

    startTransition(async () => {
      let result;

      try {
        result = await saveBuildingFacts(buildingId, submission);
      } catch {
        setErrors({ form: SAVE_FAILED });
        focusFirstError();
        return;
      }

      if (!result.ok) {
        setErrors(result.errors);
        focusFirstError();
        return;
      }

      toast.success("Building facts saved.");
      onClose();
      router.refresh();
    });
  }

  const scopeProps = { units, multiUnit };

  const footer = asking ? (
    <FooterQuestion
      question="Discard your changes?"
      keep="Keep editing"
      confirm="Discard"
      onKeep={() => setAsking(false)}
      onConfirm={onClose}
    />
  ) : (
    <div className="flex flex-col gap-3">
      {errors.form ? (
        <p
          data-error-anchor
          tabIndex={-1}
          role="alert"
          className="text-xs leading-snug text-status-danger"
        >
          {errors.form}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button type="submit" form="facts-form" disabled={pending}>
          {pending ? "Saving…" : "Save facts"}
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      title="Building facts"
      width="720px"
      footer={footer}
    >
      <form
        id="facts-form"
        ref={formRef}
        onSubmit={onSubmit}
        noValidate
        className="flex flex-col gap-7"
      >
        <EditorSection
          title="Access"
          description="A code is never shown here. Type a new one to replace it, or leave the field empty to keep it."
        >
          {fields.accessCodes.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {fields.accessCodes.map((row, index) => (
                <CodeRow
                  key={row.key}
                  row={row}
                  index={index}
                  errors={errors}
                  {...scopeProps}
                  onChange={(patch) => setCode(index, patch)}
                  onRemove={() => removeCode(index)}
                />
              ))}
            </ul>
          ) : null}
          <AddButton onClick={addCode}>Add a code</AddButton>
        </EditorSection>

        <EditorSection title="Services">
          <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">
            <DayField
              name="trashDay"
              label="Trash day"
              value={fields.trashDay}
              onChange={(day) => set("trashDay", day)}
            />
            <DayField
              name="recyclingDay"
              label="Recycling day"
              value={fields.recyclingDay}
              onChange={(day) => set("recyclingDay", day)}
            />
          </div>
          <Field
            name="recyclingNote"
            label="Recycling schedule"
            optional
            error={errors.recyclingNote}
          >
            {(control) => (
              <Input
                {...control}
                value={fields.recyclingNote}
                onChange={(event) => set("recyclingNote", event.target.value)}
                placeholder="e.g. every other week, odd weeks"
                autoComplete="off"
              />
            )}
          </Field>

          {fields.utilities.some((row) => SERVICE_KINDS.includes(row.kind)) ? (
            <ul className="flex flex-col gap-3">
              {fields.utilities.map((row, index) =>
                SERVICE_KINDS.includes(row.kind) ? (
                  <UtilityRow
                    key={row.key}
                    row={row}
                    index={index}
                    errors={errors}
                    kinds={SERVICE_KINDS}
                    contacts={contactChoices}
                    {...scopeProps}
                    onChange={(patch) => setUtility(index, patch)}
                    onRemove={() => removeUtility(index)}
                  />
                ) : null,
              )}
            </ul>
          ) : null}
          <AddButton onClick={() => addUtility("lawn")}>
            Add lawn care or snow removal
          </AddButton>
        </EditorSection>

        <EditorSection
          title="Utility accounts"
          description="With each account’s average monthly bill. A tenant-paid bill is listed on the card and left out of the owner-paid total."
        >
          {fields.utilities.some((row) => !SERVICE_KINDS.includes(row.kind)) ? (
            <ul className="flex flex-col gap-3">
              {fields.utilities.map((row, index) =>
                SERVICE_KINDS.includes(row.kind) ? null : (
                  <UtilityRow
                    key={row.key}
                    row={row}
                    index={index}
                    errors={errors}
                    kinds={ACCOUNT_KINDS}
                    {...scopeProps}
                    onChange={(patch) => setUtility(index, patch)}
                    onRemove={() => removeUtility(index)}
                  />
                ),
              )}
            </ul>
          ) : null}
          <AddButton onClick={() => addUtility("electric")}>
            Add an account
          </AddButton>
        </EditorSection>
      </form>
    </Modal>
  );
}

function EditorSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const id = `facts-editor-${title.toLowerCase().replaceAll(" ", "-")}`;

  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3
          id={id}
          className="text-sm leading-tight font-semibold text-text-primary"
        >
          {title}
        </h3>
        {description ? (
          <p className="text-xs leading-snug text-text-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function AddButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: string;
}) {
  return (
    <div>
      <Button type="button" variant="outline" size="sm" onClick={onClick}>
        <PlusIcon aria-hidden />
        {children}
      </Button>
    </div>
  );
}

/** One row's frame: its name, the way to remove it, and its fields. */
function RowFrame({
  name,
  onRemove,
  children,
}: {
  name: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-md border border-border-divider p-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-xs leading-tight font-medium text-text-secondary">
          {name}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          aria-label={`Remove ${name}`}
          className="-my-1 -mr-1.5"
        >
          <XIcon aria-hidden />
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-3">{children}</div>
    </li>
  );
}

function CodeRow({
  row,
  index,
  errors,
  units,
  multiUnit,
  onChange,
  onRemove,
}: {
  row: AccessCodeFields;
  index: number;
  errors: FieldErrors;
  units: readonly UnitOption[];
  multiUnit: boolean;
  onChange: (patch: Partial<AccessCodeFields>) => void;
  onRemove: () => void;
}) {
  const name = accessCodeName({
    label: row.label.trim() || null,
    kind: row.kind,
  });

  return (
    <RowFrame
      name={row.id === null ? `New ${name.toLowerCase()}` : name}
      onRemove={onRemove}
    >
      <Field name={`accessCodes.${index}.kind`} label="Kind">
        {(control) => (
          <Select
            value={row.kind}
            onValueChange={(kind) => onChange({ kind: kind as AccessCodeKind })}
          >
            <SelectTrigger {...control} className="w-full">
              <SelectValue>{ACCESS_CODE_KIND_LABELS[row.kind]}</SelectValue>
            </SelectTrigger>
            <SelectContent position="popper">
              {Object.entries(ACCESS_CODE_KIND_LABELS).map(([kind, label]) => (
                <SelectItem key={kind} value={kind}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      <Field
        name={codeField(index, "label")}
        label="Label"
        optional
        error={errors[codeField(index, "label")]}
      >
        {(control) => (
          <Input
            {...control}
            value={row.label}
            onChange={(event) => onChange({ label: event.target.value })}
            placeholder="e.g. Rear door"
            autoComplete="off"
          />
        )}
      </Field>

      {multiUnit ? (
        <ScopeField
          name={`accessCodes.${index}.unitId`}
          value={row.unitId}
          units={units}
          onChange={(unitId) => onChange({ unitId })}
        />
      ) : null}

      <Field
        name={codeField(index, "code")}
        label="Code"
        helper={
          row.id === null ? undefined : "Leave empty to keep the current code."
        }
        error={errors[codeField(index, "code")]}
      >
        {(control) => (
          <Input
            {...control}
            value={row.code}
            onChange={(event) => onChange({ code: event.target.value })}
            placeholder={row.id === null ? undefined : "Replace code"}
            // A code, not a word and not a password: nothing should correct
            // it, capitalise it, or offer to remember it.
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="font-mono tabular-nums"
          />
        )}
      </Field>
    </RowFrame>
  );
}

function UtilityRow({
  row,
  index,
  errors,
  kinds,
  contacts,
  units,
  multiUnit,
  onChange,
  onRemove,
}: {
  row: UtilityFields;
  index: number;
  errors: FieldErrors;
  /** The kinds this row's section offers: the services, or the accounts. */
  kinds: readonly UtilityKind[];
  /** Given for a service, which names the person to call. */
  contacts?: readonly ContactOption[];
  units: readonly UnitOption[];
  multiUnit: boolean;
  onChange: (patch: Partial<UtilityFields>) => void;
  onRemove: () => void;
}) {
  const service = contacts !== undefined;
  const name = [UTILITY_KIND_LABELS[row.kind], row.providerName.trim()]
    .filter(Boolean)
    .join(" · ");

  return (
    <RowFrame
      name={row.id === null ? `New: ${name}` : name}
      onRemove={onRemove}
    >
      <Field name={`utilities.${index}.kind`} label="Kind">
        {(control) => (
          <Select
            value={row.kind}
            onValueChange={(kind) => onChange({ kind: kind as UtilityKind })}
          >
            <SelectTrigger {...control} className="w-full">
              <SelectValue>{UTILITY_KIND_LABELS[row.kind]}</SelectValue>
            </SelectTrigger>
            <SelectContent position="popper">
              {kinds.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {UTILITY_KIND_LABELS[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      {multiUnit && !service ? (
        <ScopeField
          name={`utilities.${index}.unitId`}
          value={row.unitId}
          units={units}
          onChange={(unitId) => onChange({ unitId })}
        />
      ) : null}

      <Field
        name={utilityField(index, "providerName")}
        label={service ? "Company" : "Provider"}
        optional={service}
        error={errors[utilityField(index, "providerName")]}
      >
        {(control) => (
          <Input
            {...control}
            value={row.providerName}
            onChange={(event) => onChange({ providerName: event.target.value })}
            placeholder={service ? "e.g. Green Acres Lawn" : "e.g. AES Indiana"}
            autoComplete="off"
          />
        )}
      </Field>

      {service ? (
        <Field
          name={`utilities.${index}.contactId`}
          label="Contact"
          optional
          helper={
            contacts.length === 0
              ? "People are added in the Contact book."
              : undefined
          }
        >
          {(control) => {
            const chosen = contacts.find((c) => c.id === row.contactId);

            return (
              <Select
                value={row.contactId || NONE}
                onValueChange={(value) =>
                  onChange({ contactId: value === NONE ? "" : value })
                }
                disabled={contacts.length === 0}
              >
                <SelectTrigger {...control} className="w-full">
                  <SelectValue>
                    {chosen ? contactLabel(chosen) : "Nobody"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-72">
                  <SelectItem value={NONE}>Nobody</SelectItem>
                  {contacts.map((contact) => (
                    <SelectItem key={contact.id} value={contact.id}>
                      {contactLabel(contact)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          }}
        </Field>
      ) : (
        <Field
          name={utilityField(index, "accountRef")}
          label="Account number"
          optional
          helper="The last four characters, as the bill prints them."
          error={errors[utilityField(index, "accountRef")]}
        >
          {(control) => (
            <Input
              {...control}
              value={row.accountRef}
              onChange={(event) => onChange({ accountRef: event.target.value })}
              // No `maxLength`: it would keep the first four characters of a
              // pasted account number, which are the wrong four. The rule
              // says so instead.
              autoComplete="off"
              spellCheck={false}
              placeholder="4192"
              className="font-mono tabular-nums"
            />
          )}
        </Field>
      )}

      <Field
        name={utilityField(index, "avgMonthly")}
        label="Average bill / mo"
        optional
        error={errors[utilityField(index, "avgMonthly")]}
      >
        {(control) => (
          <MoneyInput
            {...control}
            value={row.avgMonthly}
            onChange={(event) => onChange({ avgMonthly: event.target.value })}
          />
        )}
      </Field>

      <Field name={`utilities.${index}.paidBy`} label="Paid by">
        {(control) => (
          <Select
            value={row.paidBy}
            onValueChange={(paidBy) => onChange({ paidBy: paidBy as PaidBy })}
          >
            <SelectTrigger {...control} className="w-full">
              <SelectValue>{PAID_BY_LABELS[row.paidBy]}</SelectValue>
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="owner">Owner</SelectItem>
              <SelectItem value="tenant">Tenant</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Field>
    </RowFrame>
  );
}

function contactLabel(contact: ContactOption): string {
  const name = contact.company
    ? `${contact.name} · ${contact.company}`
    : contact.name;

  return contact.archived ? `${name} (archived)` : name;
}

/** Which unit a row belongs to, or `Shared` — only on a multi-unit building. */
function ScopeField({
  name,
  value,
  units,
  onChange,
}: {
  name: string;
  value: string;
  units: readonly UnitOption[];
  onChange: (unitId: string) => void;
}) {
  const SHARED = "shared";
  const chosen = units.find((unit) => unit.id === value);

  return (
    <Field name={name} label="Scope">
      {(control) => (
        <Select
          value={value || SHARED}
          onValueChange={(unitId) => onChange(unitId === SHARED ? "" : unitId)}
        >
          <SelectTrigger {...control} className="w-full">
            <SelectValue>{chosen ? chosen.label : "Shared"}</SelectValue>
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={SHARED}>Shared</SelectItem>
            {units.map((unit) => (
              <SelectItem key={unit.id} value={unit.id}>
                {unit.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

/** A collection day, or none recorded. */
function DayField({
  name,
  label,
  value,
  onChange,
}: {
  name: string;
  label: string;
  value: Weekday | "";
  onChange: (day: Weekday | "") => void;
}) {
  return (
    <Field name={name} label={label} optional>
      {(control) => (
        <Select
          value={value || NONE}
          onValueChange={(day) =>
            onChange(day === NONE ? "" : (day as Weekday))
          }
        >
          <SelectTrigger {...control} className="w-full">
            <SelectValue>
              {value ? WEEKDAY_NAMES[value] : "Not recorded"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={NONE}>Not recorded</SelectItem>
            {Object.entries(WEEKDAY_NAMES).map(([day, dayName]) => (
              <SelectItem key={day} value={day}>
                {dayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}
