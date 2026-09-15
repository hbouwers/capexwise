"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Field, fieldId } from "@/components/field";
import { FooterQuestion, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { type ContactFields, validateContact } from "@/lib/contact-form";
import type { TradeChoice } from "@/lib/contacts";
import type { FieldErrors } from "@/lib/forms";
import {
  archiveContact,
  createContact,
  restoreContact,
  updateContact,
} from "@/server/actions/contacts";

/**
 * The contact modal (`docs/ui/screens/contacts.md`): add a contact, or edit,
 * archive and restore one. It lives in the URL — `?contact=new` or
 * `?contact={id}` — on the task modal's pattern, so the back button closes it
 * and a contact can be linked to. The page reads the contact on the server and
 * mounts this with it; closing replaces the URL without the param, and the
 * page re-renders without the modal.
 *
 * Every value is held as typed, and `validateContact` — the server action's
 * own rules — runs before anything is sent. A failed save keeps what was
 * typed and says so in the footer.
 *
 * **Closing a changed form asks first.** Escape, the scrim, `×` and `Cancel`
 * all come through `onOpenChange`, so one check covers them: with nothing
 * changed they close at once, and with something changed the footer asks
 * `Discard your changes?` — the task modal's rule, because a phone number
 * typed and lost to a stray click on the scrim is the failure it prevents.
 */

type Mode =
  | { kind: "new" }
  | { kind: "edit"; contactId: string; name: string; archived: boolean };

/** What the footer is doing: the form's buttons, or asking about one of them. */
type Asking = null | "discard" | "archive" | "restore";

/**
 * Archiving and restoring close the modal without saving the form, so with
 * something typed they say so before they do it rather than dropping it.
 */
const UNSAVED = "Your changes to this form won't be saved.";

/** Ticked trades as a set, so ticking one off and on again is no change. */
function sameFields(a: ContactFields, b: ContactFields): boolean {
  const key = (fields: ContactFields) =>
    JSON.stringify({ ...fields, trades: [...fields.trades].sort() });

  return key(a) === key(b);
}

const SAVE_FAILED =
  "Couldn’t save the contact. Check your connection and try again — what you typed is still here.";

export function ContactModal({
  mode,
  initial,
  trades,
  closeHref,
}: {
  mode: Mode;
  initial: ContactFields;
  /** Every trade, in the list's order: the checkbox list offers all of them. */
  trades: TradeChoice[];
  /** The page's URL without the modal — the filter it was opened from. */
  closeHref: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(true);
  const [fields, setFields] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [asking, setAsking] = useState<Asking>(null);
  const [pending, startTransition] = useTransition();
  /** Where focus was when the footer asked, to put it back on `Keep`. */
  const askedFrom = useRef<HTMLElement | null>(null);

  const changed = !sameFields(fields, initial);

  /** Out of the modal, to the page it was opened on. */
  function leave() {
    setOpen(false);
    router.replace(closeHref, { scroll: false });
  }

  function ask(question: Exclude<Asking, null>) {
    askedFrom.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setAsking(question);
  }

  /**
   * Back to the form, and focus back where it was — or, when the question
   * replaced the button that raised it, to that button's successor. Left to
   * itself, focus would fall to the dialog, and the keyboard would start over
   * from the top of the modal.
   */
  function keep() {
    const question = asking;
    setAsking(null);

    requestAnimationFrame(() => {
      const from = askedFrom.current;
      const target = from?.isConnected
        ? from
        : formRef.current
            ?.closest("[role=dialog]")
            ?.querySelector<HTMLElement>(`[data-asks="${question}"]`);

      target?.focus();
    });
  }

  function onOpenChange(next: boolean) {
    if (next || pending) return;

    if (changed) {
      ask("discard");
      return;
    }

    leave();
  }

  function set<K extends keyof ContactFields>(key: K, value: ContactFields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
    setAsking(null);
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

  function toggleTrade(slug: string, ticked: boolean) {
    const next = new Set(fields.trades);
    if (ticked) next.add(slug);
    else next.delete(slug);

    // Kept in the list's order, so the value sent reads like the list.
    set(
      "trades",
      trades.map((trade) => trade.slug).filter((trade) => next.has(trade)),
    );
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

    const checked = validateContact(fields);
    if (!checked.ok) {
      setErrors(checked.errors);
      focusFirstError();
      return;
    }

    setErrors({});
    setAsking(null);

    startTransition(async () => {
      let result;

      try {
        result =
          mode.kind === "new"
            ? await createContact(fields)
            : await updateContact(mode.contactId, fields);
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

      toast.success(mode.kind === "new" ? "Contact added." : "Contact saved.");
      leave();
    });
  }

  function archiveOrRestore(action: typeof archiveContact, done: string) {
    if (mode.kind !== "edit") return;

    // A question stays up while its action runs, so its button can say so; a
    // failure goes back to the form's footer, where the message goes.
    startTransition(async () => {
      const result = await action(mode.contactId).catch(() => ({ ok: false }));

      if (!result.ok) {
        setAsking(null);
        setErrors({
          form:
            action === archiveContact
              ? "Couldn’t archive the contact. Reload the page and try again."
              : "Couldn’t restore the contact. Reload the page and try again.",
        });
        focusFirstError();
        return;
      }

      toast.success(done);
      leave();
    });
  }

  const footer =
    asking === "discard" ? (
      <FooterQuestion
        question="Discard your changes?"
        keep="Keep editing"
        confirm="Discard"
        onKeep={keep}
        onConfirm={leave}
      />
    ) : asking === "archive" && mode.kind === "edit" ? (
      <FooterQuestion
        question={`Archive ${mode.name}?`}
        detail={`Keeps them on past tasks, and takes them out of this book and the assignee lists.${changed ? ` ${UNSAVED}` : ""}`}
        keep="Keep"
        confirm={pending ? "Archiving…" : "Archive contact"}
        destructive
        disabled={pending}
        onKeep={keep}
        onConfirm={() => archiveOrRestore(archiveContact, "Contact archived.")}
      />
    ) : asking === "restore" && mode.kind === "edit" ? (
      <FooterQuestion
        question={`Restore ${mode.name}?`}
        detail={`${UNSAVED} Save them first to keep them.`}
        keep="Keep editing"
        confirm={pending ? "Restoring…" : "Restore contact"}
        disabled={pending}
        onKeep={keep}
        onConfirm={() => archiveOrRestore(restoreContact, "Contact restored.")}
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
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {mode.kind === "edit" && !mode.archived ? (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                data-asks="archive"
                onClick={() => ask("archive")}
              >
                Archive contact
              </Button>
            ) : null}
            {mode.kind === "edit" && mode.archived ? (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                data-asks="restore"
                onClick={() =>
                  changed
                    ? ask("restore")
                    : archiveOrRestore(restoreContact, "Contact restored.")
                }
              >
                Restore contact
              </Button>
            ) : null}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              data-asks="discard"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" form="contact-form" disabled={pending}>
              {pending
                ? "Saving…"
                : mode.kind === "new"
                  ? "Add contact"
                  : "Save contact"}
            </Button>
          </div>
        </div>
      </div>
    );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={mode.kind === "new" ? "New contact" : mode.name}
      description={
        mode.kind === "edit" && mode.archived
          ? "Archived. Restore them to put them back in the book."
          : undefined
      }
      width="560px"
      footer={footer}
    >
      <form
        id="contact-form"
        ref={formRef}
        onSubmit={onSubmit}
        noValidate
        className="flex flex-col gap-5"
      >
        <Field name="name" label="Name" error={errors.name}>
          {(control) => (
            <Input
              {...control}
              value={fields.name}
              onChange={(event) => set("name", event.target.value)}
              autoComplete="off"
              // A new contact starts with the one field it needs. An existing
              // one opens on its details, without a keyboard springing up.
              autoFocus={mode.kind === "new"}
            />
          )}
        </Field>

        <Field name="company" label="Company" optional error={errors.company}>
          {(control) => (
            <Input
              {...control}
              value={fields.company}
              onChange={(event) => set("company", event.target.value)}
              autoComplete="off"
            />
          )}
        </Field>

        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-2.5 text-xs leading-none font-medium text-text-secondary">
            Trades
          </legend>
          <div className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
            {trades.map((trade) => {
              const id = fieldId(`trades.${trade.slug}`);

              return (
                <div key={trade.slug} className="flex items-center gap-2.5">
                  <Checkbox
                    id={id}
                    checked={fields.trades.includes(trade.slug)}
                    onCheckedChange={(checked) =>
                      toggleTrade(trade.slug, checked === true)
                    }
                  />
                  <Label
                    htmlFor={id}
                    className="text-sm leading-tight font-normal text-text-primary"
                  >
                    {trade.label}
                  </Label>
                </div>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2 sm:gap-3">
          <Field name="phone" label="Phone" optional error={errors.phone}>
            {(control) => (
              <Input
                {...control}
                type="tel"
                value={fields.phone}
                onChange={(event) => set("phone", event.target.value)}
                autoComplete="off"
                className="font-mono tabular-nums"
              />
            )}
          </Field>
          <Field name="email" label="Email" optional error={errors.email}>
            {(control) => (
              <Input
                {...control}
                type="email"
                value={fields.email}
                onChange={(event) => set("email", event.target.value)}
                autoComplete="off"
              />
            )}
          </Field>
        </div>

        <Field
          name="rateNote"
          label="Rate"
          optional
          helper="In their terms — $75 / hr, Bid basis, 8% of gross."
          error={errors.rateNote}
        >
          {(control) => (
            <Input
              {...control}
              value={fields.rateNote}
              onChange={(event) => set("rateNote", event.target.value)}
              autoComplete="off"
            />
          )}
        </Field>

        <Field name="notes" label="Notes" optional error={errors.notes}>
          {(control) => (
            <Textarea
              {...control}
              value={fields.notes}
              onChange={(event) => set("notes", event.target.value)}
              rows={3}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}
