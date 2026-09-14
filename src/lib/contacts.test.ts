import { describe, expect, it } from "vitest";

import { compareContactNames, contactsHref, tradesInUse } from "@/lib/contacts";

describe("contactsHref", () => {
  it("is the bare page with nothing chosen", () => {
    expect(contactsHref({ trade: null, archived: false, contact: null })).toBe(
      "/contacts",
    );
  });

  it("keeps the filter when the modal opens, as `?contact=new&trade=` needs", () => {
    expect(
      contactsHref({ trade: "hvac", archived: true, contact: "new" }),
    ).toBe("/contacts?trade=hvac&archived=1&contact=new");
  });
});

const TRADES = [
  { slug: "handyman", label: "Handyman" },
  { slug: "hvac", label: "HVAC" },
  { slug: "plumber", label: "Plumber" },
  { slug: "roofer", label: "Roofer" },
];

describe("tradesInUse", () => {
  it("offers only the trades somebody has, counted, in the list's order", () => {
    const contacts = [
      { trades: ["plumber", "handyman"] },
      { trades: ["plumber"] },
      { trades: [] },
    ];

    expect(tradesInUse(TRADES, contacts)).toEqual([
      { slug: "handyman", label: "Handyman", count: 1 },
      { slug: "plumber", label: "Plumber", count: 2 },
    ]);
  });

  it("offers nothing to an empty book", () => {
    expect(tradesInUse(TRADES, [])).toEqual([]);
  });
});

describe("compareContactNames", () => {
  it("sorts without regard to case", () => {
    expect(
      ["de Luca", "Abbott", "Dana", "cho"].sort(compareContactNames),
    ).toEqual(["Abbott", "cho", "Dana", "de Luca"]);
  });
});
