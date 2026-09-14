/**
 * What the contact modal's saves do inside one org: a contact written with its
 * trades, its trades made to match what was ticked, a trade that is not on the
 * list refused whole, and archive and restore. The cross-org half of these
 * actions is the isolation test's.
 *
 * Driven as the modal drives them — a signed session, then the action — so the
 * org comes from `getOrgContext()` as it does in a request. The session setup
 * is the isolation test's, which explains each line.
 */
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { contacts, contactTags } from "@/db/schema";
import {
  type ContactFields,
  contactFields,
  emptyContactFields,
} from "@/lib/contact-form";
import { UNREADABLE_FORM } from "@/lib/forms";
import { applicationDatabaseUrl, testDb } from "@/test/db";
import {
  createContact,
  createMembership,
  createOrganization,
  createUser,
  tagContact,
} from "@/test/factories";

const request = vi.hoisted(() => ({ headers: new Headers() }));

vi.mock("next/headers", () => ({
  headers: async () => request.headers,
}));

process.env.DATABASE_URL = applicationDatabaseUrl;
process.env.APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "integration-suite-secret-not-a-real-one";
process.env.GOOGLE_CLIENT_ID = "integration-suite-client-id";
process.env.GOOGLE_CLIENT_SECRET = "integration-suite-client-secret";
// Base64url of "integration-suite-not-a-real-key": a shape, not a secret.
process.env.ACCESS_CODE_KEYS = "1:aW50ZWdyYXRpb24tc3VpdGUtbm90LWEtcmVhbC1rZXk";

// Dynamic, and after the assignments above, for the reason the isolation test
// gives. A namespace, because `createContact` is also the factory's name.
const { getAuth } = await import("@/server/auth");
const actions = await import("@/server/actions/contacts");
const { getContact, listContacts } = await import("@/server/queries/contacts");

/** An org with an owner, signed in as the requests below. */
async function signedInOrg() {
  const org = await createOrganization();
  const owner = await createUser();
  await createMembership(org.id, owner.id, { role: "owner" });

  const context = await getAuth().$context;
  const session = await context.internalAdapter.createSession(owner.id, false);
  const signature = await makeSignature(session.token, context.secret);

  request.headers = new Headers({
    cookie: `${context.authCookies.sessionToken.name}=${session.token}.${signature}`,
  });

  return org;
}

async function tagsOf(contactId: string) {
  return await testDb()
    .select({ tag: contactTags.tag, createdAt: contactTags.createdAt })
    .from(contactTags)
    .where(eq(contactTags.contactId, contactId))
    .orderBy(contactTags.tag);
}

/** A plumber who also does odd jobs, as the modal opens them. */
async function plumber() {
  const org = await signedInOrg();
  const contact = await createContact(org.id, { name: "Dana Whitfield" });
  await tagContact(org.id, contact.id, "plumber");
  await tagContact(org.id, contact.id, "handyman");

  return {
    org,
    contact,
    form: contactFields({ ...contact, trades: ["plumber", "handyman"] }),
  };
}

describe("createContact", () => {
  it("writes the contact and its trades", async () => {
    const org = await signedInOrg();

    const form: ContactFields = {
      ...emptyContactFields("hvac"),
      name: "Ray Okonkwo",
      company: "Okonkwo Heating & Air",
      trades: ["hvac", "electrician"],
      phone: "(317) 555-0199",
      rateNote: "$120 / hr, 1 hr minimum",
    };

    const result = await actions.createContact(form);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const [row] = await testDb()
      .select()
      .from(contacts)
      .where(eq(contacts.id, result.contactId));

    expect(row).toMatchObject({
      orgId: org.id,
      name: "Ray Okonkwo",
      company: "Okonkwo Heating & Air",
      phone: "(317) 555-0199",
      email: null,
      rateNote: "$120 / hr, 1 hr minimum",
      archivedAt: null,
    });
    expect((await tagsOf(result.contactId)).map((row) => row.tag)).toEqual([
      "electrician",
      "hvac",
    ]);
  });

  it("refuses a trade that is not on the list, and writes nothing", async () => {
    // Well-formed, so the form's rules pass it, and not a trade, so the
    // database refuses the tag — and with it the contact, in one transaction.
    await signedInOrg();

    const result = await actions.createContact({
      ...emptyContactFields(),
      name: "Ray Okonkwo",
      trades: ["hvac", "chimney-sweep"],
    });

    expect(result).toEqual({ ok: false, errors: { form: UNREADABLE_FORM } });
    expect(await testDb().select().from(contacts)).toEqual([]);
  });

  it("reports the form's rules, and writes nothing", async () => {
    await signedInOrg();

    const result = await actions.createContact({
      ...emptyContactFields(),
      email: "ray",
    });

    expect(result).toEqual({
      ok: false,
      errors: {
        name: "Enter their name.",
        email: "Enter an email address, like name@example.com.",
      },
    });
    expect(await testDb().select().from(contacts)).toEqual([]);
  });
});

describe("updateContact", () => {
  it("makes the trades match what was ticked, and leaves a kept one alone", async () => {
    const { contact, form } = await plumber();
    const [handyman] = (await tagsOf(contact.id)).filter(
      (row) => row.tag === "handyman",
    );

    const result = await actions.updateContact(contact.id, {
      ...form,
      trades: ["handyman", "painter"],
      rateNote: "$75 / hr",
    });

    expect(result).toEqual({ ok: true, contactId: contact.id });

    const tags = await tagsOf(contact.id);
    expect(tags.map((row) => row.tag)).toEqual(["handyman", "painter"]);
    // The same row, not a deleted and rewritten one.
    expect(tags[0]?.createdAt).toEqual(handyman?.createdAt);
    expect((await getContact(contact.id))?.rateNote).toBe("$75 / hr");
  });

  it("clears every trade when none is ticked", async () => {
    const { contact, form } = await plumber();

    await actions.updateContact(contact.id, { ...form, trades: [] });

    expect(await tagsOf(contact.id)).toEqual([]);
  });

  it("refuses a trade that is not on the list, and changes nothing", async () => {
    const { contact, form } = await plumber();
    const before = await getContact(contact.id);

    const result = await actions.updateContact(contact.id, {
      ...form,
      name: "Dana W.",
      trades: ["plumber", "chimney-sweep"],
    });

    expect(result).toEqual({ ok: false, errors: { form: UNREADABLE_FORM } });
    expect(await getContact(contact.id)).toEqual(before);
  });

  it("refuses an id that is not a contact", async () => {
    const { form } = await plumber();

    for (const id of ["not-an-id", "0192f0c4-5b1e-7c3a-9d2e-4f6a8b0c1d2e"]) {
      expect(await actions.updateContact(id, form)).toEqual({
        ok: false,
        errors: {
          form: "This contact could not be found. It may be in another organization.",
        },
      });
    }
  });
});

describe("archiveContact and restoreContact", () => {
  it("takes a contact out of the book and puts them back, keeping their trades", async () => {
    const { contact } = await plumber();

    expect(await actions.archiveContact(contact.id)).toEqual({ ok: true });
    expect((await getContact(contact.id))?.archivedAt).toBeInstanceOf(Date);
    // Archived, not gone: still listed, for the page to put in its place.
    expect((await listContacts()).map((row) => row.id)).toEqual([contact.id]);

    // Once is enough: a second archive has nothing to do.
    expect(await actions.archiveContact(contact.id)).toEqual({ ok: false });

    expect(await actions.restoreContact(contact.id)).toEqual({ ok: true });
    // Trades in the list's own order, handyman before plumber.
    expect(await getContact(contact.id)).toMatchObject({
      archivedAt: null,
      trades: ["handyman", "plumber"],
    });
  });
});
