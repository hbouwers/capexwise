import { describe, expect, it } from "vitest";

import {
  type ContactFields,
  contactFields,
  emptyContactFields,
  telHref,
  validateContact,
} from "@/lib/contact-form";
import { UNREADABLE_FORM } from "@/lib/forms";

/** A plumber, as typed into the modal. */
function plumber(overrides: Partial<ContactFields> = {}): ContactFields {
  return {
    ...emptyContactFields(),
    name: "Dana Whitfield",
    company: "Whitfield Plumbing",
    trades: ["plumber"],
    phone: "317-555-0142",
    email: "dana@example.test",
    rateNote: "$95 / hr",
    ...overrides,
  };
}

function errorsOf(input: unknown) {
  const result = validateContact(input);
  if (result.ok) throw new Error("Expected the contact to be refused.");

  return result.errors;
}

describe("validateContact", () => {
  it("writes what was typed, trimmed, with an empty field stored as nothing", () => {
    const result = validateContact(
      plumber({ name: "  Dana Whitfield ", company: " ", notes: "" }),
    );

    expect(result).toEqual({
      ok: true,
      values: {
        name: "Dana Whitfield",
        company: null,
        phone: "317-555-0142",
        email: "dana@example.test",
        rateNote: "$95 / hr",
        notes: null,
        trades: ["plumber"],
      },
    });
  });

  it("needs a name, and nothing else", () => {
    expect(errorsOf(plumber({ name: "   " }))).toEqual({
      name: "Enter their name.",
    });

    // A name alone is a contact: a neighbour who plows, a number to find later.
    expect(validateContact({ ...emptyContactFields(), name: "Sam" }).ok).toBe(
      true,
    );
  });

  it("reports every problem at once", () => {
    expect(
      Object.keys(errorsOf(plumber({ name: "", phone: "555", email: "dana" }))),
    ).toEqual(["name", "phone", "email"]);
  });

  it.each([
    "317-555-0142",
    "(317) 555-0142",
    "317.555.0142",
    "+1 317 555 0142",
    "317-555-0142 x12",
    "317-555-0142 ext. 12",
    "5550142",
  ])("takes %s as a phone number", (phone) => {
    expect(validateContact(plumber({ phone })).ok).toBe(true);
  });

  it.each([
    ["too few digits to call", "555-01"],
    ["words", "call after 5"],
    ["letters for digits", "317-555-CALL"],
    ["an extension with no number", "317-555-0142 x"],
    ["more digits than any number has", "+1 317 555 0142 0142 99"],
  ])("refuses %s as a phone number", (_, phone) => {
    expect(errorsOf(plumber({ phone }))).toEqual({
      phone: "Enter a phone number with its area code, like 317-555-0142.",
    });
  });

  it.each(["dana", "dana@", "dana@example", "dana @example.test"])(
    "refuses %s as an email address",
    (email) => {
      expect(errorsOf(plumber({ email }))).toEqual({
        email: "Enter an email address, like name@example.com.",
      });
    },
  );

  it.each([
    ["a submission that is not an object", "Dana"],
    ["a field that is not text", { ...plumber(), name: 42 }],
    ["a missing field", { name: "Dana" }],
    ["the same trade twice", plumber({ trades: ["plumber", "plumber"] })],
    ["a trade that is not a slug", plumber({ trades: ["Plumber"] })],
    ["a name no person has", plumber({ name: "x".repeat(501) })],
  ])("refuses %s as unreadable", (_, input) => {
    expect(errorsOf(input)).toEqual({ form: UNREADABLE_FORM });
  });
});

describe("emptyContactFields", () => {
  it("arrives with the filtered trade ticked", () => {
    expect(emptyContactFields("hvac").trades).toEqual(["hvac"]);
    expect(emptyContactFields().trades).toEqual([]);
  });
});

describe("contactFields", () => {
  it("saves back exactly what it read", () => {
    const stored = {
      name: "Dana Whitfield",
      company: null,
      phone: "317-555-0142",
      email: null,
      rateNote: "Bid basis",
      notes: "Prefers texts.",
      trades: ["plumber", "handyman"],
    };

    expect(validateContact(contactFields(stored))).toEqual({
      ok: true,
      values: stored,
    });
  });
});

describe("telHref", () => {
  it.each([
    ["317-555-0142", "tel:3175550142"],
    ["(317) 555-0142", "tel:3175550142"],
    ["+1 317 555 0142", "tel:+13175550142"],
    ["317-555-0142 x12", "tel:3175550142;ext=12"],
    ["317-555-0142 ext. 12", "tel:3175550142;ext=12"],
  ])("dials %s as %s", (phone, href) => {
    expect(telHref(phone)).toBe(href);
  });

  it("keeps an extension's digits out of the number it dials", () => {
    // The bug this exists to prevent: stripping every non-digit would dial
    // 317-555-014-212, which is not the number on the card.
    expect(telHref("317-555-0142 x12")).not.toBe("tel:317555014212");
  });

  it("gives no link for a value that is not a number", () => {
    expect(telHref("call after 5")).toBeNull();
  });
});
