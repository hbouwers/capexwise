/**
 * The contact modal's rules, once, for both sides of it
 * (`docs/ui/screens/contacts.md`, the contact modal). The browser runs
 * `validateContact` before it sends anything and the server action runs it
 * again on whatever arrives — `building-form.ts` explains why one function
 * serves both.
 *
 * Framework-free, like the rest of `src/lib`. It knows the shape of a trade's
 * slug but not the list of trades, which is the database's: a slug that is
 * well-formed and not on the list is the action's to refuse.
 */
import { z } from "zod";

import { type FieldErrors, UNREADABLE_FORM } from "@/lib/forms";

/** The whole form, as typed. `trades` is the slugs that are ticked. */
export type ContactFields = {
  name: string;
  company: string;
  trades: string[];
  phone: string;
  email: string;
  rateNote: string;
  notes: string;
};

/**
 * The form, as the database will hold it. Every key but `trades` is a column
 * of `contacts` under its Drizzle name, so the action writes it as it is.
 */
export type ContactValues = {
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  rateNote: string | null;
  notes: string | null;
  trades: string[];
};

export type ValidatedContact =
  { ok: true; values: ContactValues } | { ok: false; errors: FieldErrors };

/**
 * The shape a submission has to have before its values are worth reading.
 * The lengths are ceilings against a request built by hand, not rules a person
 * meets. Nineteen trades exist; fifty is room for the list to grow without a
 * change here.
 */
const line = z.string().max(500);

const shape = z.object({
  name: line,
  company: line,
  trades: z
    .array(z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/))
    .max(50)
    .refine((slugs) => new Set(slugs).size === slugs.length),
  phone: line,
  email: line,
  rateNote: line,
  notes: z.string().max(5000),
});

/**
 * Loose on purpose. A check that tried to be RFC 5322 would refuse addresses
 * that work; this one refuses what is plainly not an address — no `@`, no
 * domain, a space — which is the typo worth catching before a `mailto:` link
 * goes nowhere.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A phone number as people write one — `317-555-0142`, `(317) 555 0142`,
 * `+1 317 555 0142`, with an `x12` or `ext. 12` on the end — and nothing else,
 * because the card turns it into a `tel:` link and letters in it would dial
 * something else. Seven to fifteen digits before any extension: fewer is not a
 * number anyone can call, and fifteen is the longest the international format
 * allows.
 */
const PHONE = /^\+?[\d\s().-]+?(?:\s*(?:x|ext\.?)\s*(\d{1,6}))?$/i;

function mainDigits(phone: string): string {
  return phone.replace(/\s*(?:x|ext\.?)\s*\d+$/i, "").replace(/\D/g, "");
}

function isPhone(phone: string): boolean {
  if (!PHONE.test(phone)) return false;

  const digits = mainDigits(phone).length;
  return digits >= 7 && digits <= 15;
}

/**
 * The `tel:` link for a stored number: its digits, a leading `+` if it had
 * one, and an extension in the form RFC 3966 gives it. Built from what was
 * typed rather than from a canonical number nobody entered, so the link and
 * the text beside it are the same number. `null` for a value that is not one,
 * which the card then shows as text.
 */
export function telHref(phone: string): string | null {
  const value = phone.trim();
  if (!isPhone(value)) return null;

  const extension = PHONE.exec(value)?.[1];
  const plus = value.startsWith("+") ? "+" : "";

  return `tel:${plus}${mainDigits(value)}${extension ? `;ext=${extension}` : ""}`;
}

/**
 * Every rule the modal states, or every message at once — `building-form.ts`
 * says why never the first one only.
 */
export function validateContact(input: unknown): ValidatedContact {
  const parsed = shape.safeParse(input);
  if (!parsed.success) return { ok: false, errors: { form: UNREADABLE_FORM } };

  const fields = parsed.data;
  const errors: FieldErrors = {};

  function optional(value: string): string | null {
    const trimmed = value.trim();

    return trimmed === "" ? null : trimmed;
  }

  const name = fields.name.trim();
  if (name === "") errors.name = "Enter their name.";

  const phone = optional(fields.phone);
  if (phone !== null && !isPhone(phone)) {
    errors.phone =
      "Enter a phone number with its area code, like 317-555-0142.";
  }

  const email = optional(fields.email);
  if (email !== null && !EMAIL.test(email)) {
    errors.email = "Enter an email address, like name@example.com.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    values: {
      name,
      company: optional(fields.company),
      phone,
      email,
      rateNote: optional(fields.rateNote),
      notes: optional(fields.notes),
      trades: fields.trades,
    },
  };
}

/**
 * A new contact: nothing typed, and the trade the page was filtered to ticked
 * already — `?contact=new&trade=hvac` arrives with HVAC ticked.
 */
export function emptyContactFields(trade?: string): ContactFields {
  return {
    name: "",
    company: "",
    trades: trade ? [trade] : [],
    phone: "",
    email: "",
    rateNote: "",
    notes: "",
  };
}

/** The edit form, prefilled from what is stored. */
export function contactFields(contact: {
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  rateNote: string | null;
  notes: string | null;
  trades: readonly string[];
}): ContactFields {
  return {
    name: contact.name,
    company: contact.company ?? "",
    trades: [...contact.trades],
    phone: contact.phone ?? "",
    email: contact.email ?? "",
    rateNote: contact.rateNote ?? "",
    notes: contact.notes ?? "",
  };
}
