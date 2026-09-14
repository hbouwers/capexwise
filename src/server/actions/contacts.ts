"use server";

/**
 * The contact modal's writes (`docs/ui/screens/contacts.md`): add, edit,
 * archive and restore. Every one starts with `getOrgContext()`, so the org
 * they write to is the session's and never the request's, and an id a browser
 * sends is looked up inside the org rather than trusted. Every input is
 * `unknown`, and `validateContact` is the same function the modal runs — the
 * building actions say why both.
 *
 * **Nothing a contact holds is ever logged**, including in a failed save's
 * error. A contact is other people's name, phone and email (`CLAUDE.md`), and
 * a failed query's error carries every bound parameter of it — so a write that
 * fails is caught here, and what escapes to Next.js's log says which rule
 * Postgres applied and nothing else (`src/lib/query-errors.ts`).
 */

import { and, eq, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";

import { contacts, contactTags } from "@/db/schema";
import { validateContact } from "@/lib/contact-form";
import { type FieldErrors, UNREADABLE_FORM } from "@/lib/forms";
import { sqlState, withoutParameters } from "@/lib/query-errors";
import { getOrgContext, type OrgScopedTx } from "@/server/org-context";

export type SaveContactResult =
  { ok: true; contactId: string } | { ok: false; errors: FieldErrors };

/**
 * The same words for a contact that does not exist and one in another org, as
 * the page treats them the same — so an action cannot be used to learn which
 * ids exist.
 */
const NOT_FOUND =
  "This contact could not be found. It may be in another organization.";

/** A reference to a row that is not there: here, a trade not on the list. */
const FOREIGN_KEY_VIOLATION = "23503";

const contactIdSchema = z.uuid();

function refused(message: string): SaveContactResult {
  return { ok: false, errors: { form: message } };
}

/**
 * Runs a save, and turns its failure into something safe to say and to log.
 *
 * A trade that is well-formed and not on the list reaches the database, which
 * refuses the tag; the modal only offers trades that are, so that is a request
 * the form did not make, and it gets the form's one message for those. Any
 * other failure is re-thrown without its parameters. The transaction has
 * rolled back either way, so a refused save wrote nothing — not the contact
 * without its tags.
 */
async function save(
  what: string,
  write: () => Promise<SaveContactResult>,
): Promise<SaveContactResult> {
  try {
    return await write();
  } catch (error) {
    if (sqlState(error) === FOREIGN_KEY_VIOLATION) {
      return refused(UNREADABLE_FORM);
    }

    throw withoutParameters(error, what);
  }
}

async function addTags(
  tx: OrgScopedTx,
  orgId: string,
  contactId: string,
  trades: readonly string[],
) {
  if (trades.length === 0) return;

  await tx
    .insert(contactTags)
    .values(trades.map((tag) => ({ orgId, contactId, tag })))
    .onConflictDoNothing();
}

/** A new contact and its trades, in one transaction. */
export async function createContact(
  input: unknown,
): Promise<SaveContactResult> {
  const { db } = await getOrgContext();

  const validated = validateContact(input);
  if (!validated.ok) return validated;

  const { trades, ...contact } = validated.values;

  return await save("Adding a contact", () =>
    db.run(async (tx) => {
      const [row] = await tx
        .insert(contacts)
        .values({ ...contact, orgId: db.orgId })
        .returning({ id: contacts.id });

      if (!row) throw new Error("Inserting a contact returned no row.");

      await addTags(tx, db.orgId, row.id, trades);

      return { ok: true, contactId: row.id };
    }),
  );
}

/**
 * The modal's save on an existing contact: its fields, and its trades made to
 * match what was ticked. A tag that stays is left alone rather than deleted
 * and written again, so its `created_at` still says when the trade was added.
 * An archived contact can be edited as well; archiving takes it out of the
 * book, not out of reach.
 */
export async function updateContact(
  contactId: unknown,
  input: unknown,
): Promise<SaveContactResult> {
  const { db } = await getOrgContext();

  const id = contactIdSchema.safeParse(contactId);
  if (!id.success) return refused(NOT_FOUND);

  const validated = validateContact(input);
  if (!validated.ok) return validated;

  const { trades, ...contact } = validated.values;

  return await save("Saving a contact", () =>
    db.run(async (tx): Promise<SaveContactResult> => {
      const [existing] = await tx
        .update(contacts)
        .set(contact)
        .where(and(eq(contacts.orgId, db.orgId), eq(contacts.id, id.data)))
        .returning({ id: contacts.id });

      if (!existing) return refused(NOT_FOUND);

      await tx
        .delete(contactTags)
        .where(
          and(
            eq(contactTags.orgId, db.orgId),
            eq(contactTags.contactId, existing.id),
            trades.length > 0 ? notInArray(contactTags.tag, trades) : undefined,
          ),
        );

      await addTags(tx, db.orgId, existing.id, trades);

      return { ok: true, contactId: existing.id };
    }),
  );
}

/**
 * Takes a contact out of the book and the assignee lists, and keeps them on
 * every past task (§7). `ok: false` for a contact that is not there, not this
 * org's, or already archived — the modal has nothing different to say about
 * any of them.
 */
export async function archiveContact(
  contactId: unknown,
): Promise<{ ok: boolean }> {
  const { db } = await getOrgContext();

  const id = contactIdSchema.safeParse(contactId);
  if (!id.success) return { ok: false };

  const rows = await db.run((tx) =>
    tx
      .update(contacts)
      .set({ archivedAt: sql`now()` })
      .where(
        and(
          eq(contacts.orgId, db.orgId),
          eq(contacts.id, id.data),
          isNull(contacts.archivedAt),
        ),
      )
      .returning({ id: contacts.id }),
  );

  return { ok: rows.length === 1 };
}

/** Puts an archived contact back in the book. */
export async function restoreContact(
  contactId: unknown,
): Promise<{ ok: boolean }> {
  const { db } = await getOrgContext();

  const id = contactIdSchema.safeParse(contactId);
  if (!id.success) return { ok: false };

  const rows = await db.run((tx) =>
    tx
      .update(contacts)
      .set({ archivedAt: null })
      .where(
        and(
          eq(contacts.orgId, db.orgId),
          eq(contacts.id, id.data),
          isNotNull(contacts.archivedAt),
        ),
      )
      .returning({ id: contacts.id }),
  );

  return { ok: rows.length === 1 };
}
