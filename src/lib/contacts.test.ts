import { describe, expect, it } from "vitest";

import { compareContactNames, tradesInUse } from "@/lib/contacts";

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
