/**
 * What every form's rules report, whichever form they are for: a message per
 * field, and one message for a submission no form could have made. A form's
 * own rules are in its own file — `building-form.ts`, `contact-form.ts` — and
 * both sides of each form run them, so the browser and the server action say
 * the same thing in the same place.
 */

/**
 * A message per field, keyed by the field's path — `city`, `units.1.rent`.
 * One key belongs to no single input: `form`, for what no field can fix. A
 * form may add others for a group of fields, and says so.
 */
export type FieldErrors = Partial<Record<string, string>>;

/**
 * For a submission with the wrong shape. A browser running the form cannot
 * fail that check, so failing it means the request was not made by the form,
 * and one message covers every way that happens.
 */
export const UNREADABLE_FORM =
  "Something went wrong reading the form. Reload the page and enter it again.";
