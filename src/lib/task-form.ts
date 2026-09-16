/**
 * The two inline add rows, once, for both sides of each
 * (`docs/ui/screens/maintenance.md`, `building-detail.md`): Maintenance's,
 * which adds a one-off job waiting for a date, and the building page's, which
 * adds a recurring task first due one interval from today. The browser runs
 * the validator before it sends anything and the server action runs it again
 * — `building-form.ts` explains why one function serves both.
 *
 * Everything else about a task — its date, assignee, cost, trade — is the task
 * modal's (#114).
 */
import { z } from "zod";

import { type FieldErrors, UNREADABLE_FORM } from "@/lib/forms";
import { type Frequency, isFrequency } from "@/lib/tasks";

/** The row, as typed and chosen. */
export type NewTaskFields = {
  title: string;
  /** A building's id — chosen on Maintenance, fixed on a building's page. */
  buildingId: string;
  /** `shared`, or a unit of that building. */
  scope: string;
  /** Months, as the frequency `Select` holds it; empty for a one-off. */
  recurrence: string;
};

export type NewTaskValues = {
  title: string;
  buildingId: string;
  /** Null for the building's own. Still to be found in the building. */
  unitId: string | null;
  recurrenceMonths: Frequency | null;
};

export type ValidatedNewTask =
  { ok: true; values: NewTaskValues } | { ok: false; errors: FieldErrors };

/** Long enough for any job's name; a paragraph belongs in the notes. */
export const TITLE_MAX = 200;

const shape = z.object({
  title: z.string().max(5000),
  buildingId: z.string().max(100),
  scope: z.string().max(100),
  recurrence: z.string().max(10),
});

const uuid = z.uuid();

export function validateNewTask(input: unknown): ValidatedNewTask {
  const parsed = shape.safeParse(input);
  if (!parsed.success) return { ok: false, errors: { form: UNREADABLE_FORM } };

  const fields = parsed.data;
  const errors: FieldErrors = {};

  const title = fields.title.trim();
  if (title === "") {
    errors.title = "Enter what needs doing.";
  } else if (title.length > TITLE_MAX) {
    errors.title = `Keep it to ${TITLE_MAX} characters — put the rest in the task’s notes.`;
  }

  if (fields.buildingId === "") {
    errors.buildingId = "Choose the building it’s for.";
  } else if (!uuid.safeParse(fields.buildingId).success) {
    return { ok: false, errors: { form: UNREADABLE_FORM } };
  }

  const shared = fields.scope === "shared";
  if (!shared && !uuid.safeParse(fields.scope).success) {
    return { ok: false, errors: { form: UNREADABLE_FORM } };
  }

  let recurrenceMonths: Frequency | null = null;
  if (fields.recurrence !== "") {
    const months = Number(fields.recurrence);
    if (!isFrequency(months)) {
      return { ok: false, errors: { form: UNREADABLE_FORM } };
    }
    recurrenceMonths = months;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    values: {
      title,
      buildingId: fields.buildingId,
      unitId: shared ? null : fields.scope,
      recurrenceMonths,
    },
  };
}
