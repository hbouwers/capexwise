/**
 * The parts of the contact book that live in SQL: the seeded trade list, the
 * references between a contact, its tags and the trades, and what each does
 * on delete. `npm run typecheck` sees none of them, and every one is a claim
 * `docs/data-model.md` §6 and §7 make in prose. The pattern is
 * `organizations.integration.test.ts`.
 */
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { contacts, contactTags, tradeTags } from "@/db/schema";
import { testDb } from "@/test/db";
import {
  createContact,
  createOrganization,
  tagContact,
} from "@/test/factories";
import {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  RESTRICT_VIOLATION,
  rejectsWith,
  UNIQUE_VIOLATION,
} from "@/test/postgres-errors";

describe("trade_tags", () => {
  it("holds PRD F6's nineteen trades, in its order, from the migrations", async () => {
    // Seeded by `drizzle/0013`, not by this suite — and still here, because
    // the harness leaves reference data out of the truncation between tests.
    const rows = await testDb()
      .select({ slug: tradeTags.slug })
      .from(tradeTags)
      .orderBy(asc(tradeTags.sortOrder));

    expect(rows.map((row) => row.slug)).toEqual([
      "handyman",
      "general-contractor",
      "hvac",
      "plumber",
      "electrician",
      "roofer",
      "painter",
      "landscaper",
      "snow-removal",
      "pest-control",
      "turnover-cleaner",
      "locksmith",
      "chimney",
      "appliance-repair",
      "realtor",
      "property-manager",
      "cpa",
      "attorney",
      "inspector",
    ]);
  });

  it("refuses a slug a URL would have to escape", async () => {
    // The slug is what `?trade=` carries.
    for (const slug of [
      "Snow Removal",
      "snow_removal",
      "-snow",
      "snow--removal",
    ]) {
      await expect(
        testDb().insert(tradeTags).values({ slug, label: "Snow removal" }),
      ).rejects.toSatisfy(rejectsWith(CHECK_VIOLATION));
    }
  });

  it("refuses to delete a trade somebody is tagged with", async () => {
    // §7: reference data is not deleted, and a delete that would silently
    // untag every contact who has it is exactly why.
    const org = await createOrganization();
    const contact = await createContact(org.id);
    await tagContact(org.id, contact.id, "roofer");

    await expect(
      testDb().delete(tradeTags).where(eq(tradeTags.slug, "roofer")),
    ).rejects.toSatisfy(rejectsWith(RESTRICT_VIOLATION));
  });
});

describe("contacts", () => {
  it("starts in the book, not archived", async () => {
    const org = await createOrganization();
    const contact = await createContact(org.id);

    expect(contact.archivedAt).toBeNull();
    expect(contact.rateNote).toBeNull();
  });
});

describe("contact_tags", () => {
  it("refuses a trade that is not on the list", async () => {
    const org = await createOrganization();
    const contact = await createContact(org.id);

    await expect(
      tagContact(org.id, contact.id, "chimney-sweep"),
    ).rejects.toSatisfy(rejectsWith(FOREIGN_KEY_VIOLATION));
  });

  it("refuses the same trade twice on one contact", async () => {
    const org = await createOrganization();
    const contact = await createContact(org.id);
    await tagContact(org.id, contact.id, "hvac");

    await expect(tagContact(org.id, contact.id, "hvac")).rejects.toSatisfy(
      rejectsWith(UNIQUE_VIOLATION),
    );
  });

  it("refuses a tag in one org on a contact in another", async () => {
    // Through the harness's own connection, which is past row-level security:
    // this is `contact_tags_contact` refusing the row on its own, whatever the
    // policies would have said about it.
    const mine = await createOrganization();
    const theirs = await createOrganization();
    const contact = await createContact(theirs.id);

    await expect(tagContact(mine.id, contact.id, "hvac")).rejects.toSatisfy(
      rejectsWith(FOREIGN_KEY_VIOLATION),
    );
  });

  it("goes with its contact", async () => {
    const org = await createOrganization();
    const contact = await createContact(org.id);
    await tagContact(org.id, contact.id, "plumber");
    await tagContact(org.id, contact.id, "handyman");

    await testDb().delete(contacts).where(eq(contacts.id, contact.id));

    expect(
      await testDb()
        .select()
        .from(contactTags)
        .where(eq(contactTags.contactId, contact.id)),
    ).toEqual([]);
  });
});
