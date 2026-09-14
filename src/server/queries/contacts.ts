/**
 * Every read of the contact book a screen makes: the trade list, the book, and
 * the one contact the modal opens. Server-only, and each starts from
 * `getOrgContext()`, which is cached per request.
 *
 * Every query on an org's table filters on `db.orgId` as well as running
 * through the scoped handle; `src/server/org-context.ts` says why it is written
 * anyway. The trade list is the exception, because it has no org: every org
 * reads all of it (`docs/data-model.md` §6).
 */
import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { cache } from "react";
import { z } from "zod";

import { contacts, contactTags, tradeTags } from "@/db/schema";
import { compareContactNames, type TradeChoice } from "@/lib/contacts";
import { getOrgContext, type OrgScopedTx } from "@/server/org-context";

/** The trade list, in its own order. Memoised per request. */
export const listTradeTags = cache(async function listTradeTags(): Promise<
  TradeChoice[]
> {
  const { db } = await getOrgContext();

  return await db.run((tx) =>
    tx
      .select({ slug: tradeTags.slug, label: tradeTags.label })
      .from(tradeTags)
      .orderBy(asc(tradeTags.sortOrder), asc(tradeTags.slug)),
  );
});

/** One contact, as the card and the modal both read it. */
export type ContactRecord = {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  rateNote: string | null;
  notes: string | null;
  archivedAt: Date | null;
  /** Slugs, in the trade list's order. */
  trades: string[];
};

const contactColumns = {
  id: contacts.id,
  name: contacts.name,
  company: contacts.company,
  phone: contacts.phone,
  email: contacts.email,
  rateNote: contacts.rateNote,
  notes: contacts.notes,
  archivedAt: contacts.archivedAt,
};

/**
 * The tags of the org's contacts — of one, when `contactId` is given — as a
 * map from contact to slugs in the trade list's order. A second query rather
 * than an aggregate in the first, so both come back as plain typed rows.
 */
async function tagsByContact(
  tx: OrgScopedTx,
  orgId: string,
  contactId?: string,
): Promise<Map<string, string[]>> {
  const rows = await tx
    .select({ contactId: contactTags.contactId, tag: contactTags.tag })
    .from(contactTags)
    .innerJoin(tradeTags, eq(tradeTags.slug, contactTags.tag))
    .where(
      and(
        eq(contactTags.orgId, orgId),
        contactId ? eq(contactTags.contactId, contactId) : undefined,
      ),
    )
    .orderBy(asc(tradeTags.sortOrder), asc(tradeTags.slug));

  const byContact = new Map<string, string[]>();

  for (const row of rows) {
    const tags = byContact.get(row.contactId) ?? [];
    tags.push(row.tag);
    byContact.set(row.contactId, tags);
  }

  return byContact;
}

/**
 * Every contact in the org, archived ones included, sorted by name — the page
 * decides which of them the book shows. One org's contacts are tens, not
 * thousands, so the book reads them whole and filters by trade without a
 * second round trip per chip.
 */
export async function listContacts(): Promise<ContactRecord[]> {
  const { db } = await getOrgContext();

  const records = await db.run(async (tx) => {
    const rows = await tx
      .select(contactColumns)
      .from(contacts)
      .where(eq(contacts.orgId, db.orgId));
    const tags = await tagsByContact(tx, db.orgId);

    return rows.map((row) => ({ ...row, trades: tags.get(row.id) ?? [] }));
  });

  // Sorted here rather than in SQL, with the collator the rest of the book
  // uses; the id settles two people with the same name the same way twice.
  return records.sort(
    (a, b) => compareContactNames(a.name, b.name) || a.id.localeCompare(b.id),
  );
}

/** `buildings.ts` says why an id from a URL is parsed before it is used. */
const contactIdSchema = z.uuid();

/**
 * One contact and its trades, or `null` — for an id that does not exist, one
 * that is not an id, and one in another org alike, so a URL cannot be used to
 * learn which ids exist. Archived contacts are found: the modal is where one
 * is restored. Memoised per request.
 */
export const getContact = cache(async function getContact(
  contactId: unknown,
): Promise<ContactRecord | null> {
  const { db } = await getOrgContext();

  const id = contactIdSchema.safeParse(contactId);
  if (!id.success) return null;

  return await db.run(async (tx) => {
    const [row] = await tx
      .select(contactColumns)
      .from(contacts)
      .where(and(eq(contacts.orgId, db.orgId), eq(contacts.id, id.data)));

    if (!row) return null;

    const tags = await tagsByContact(tx, db.orgId, row.id);

    return { ...row, trades: tags.get(row.id) ?? [] };
  });
});
