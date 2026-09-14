/**
 * The building form's rules, which the server action runs again on whatever
 * arrives. The basis cases matter most: they are what the tax planner will
 * depreciate, and the constraint in the database is the only other thing that
 * checks them.
 */
import { describe, expect, it } from "vitest";

import {
  type BuildingFields,
  buildingFields,
  buildingValue,
  emptyBuildingFields,
  moneyField,
  nextUnitLabel,
  UNREADABLE_FORM,
  validateBuilding,
} from "@/lib/building-form";

const INDY = "America/Indiana/Indianapolis";

/** A duplex on Delaware Street, one side let, one empty. */
function duplex(overrides: Partial<BuildingFields> = {}): BuildingFields {
  return {
    ...emptyBuildingFields(),
    addressLine1: "412 N Delaware St",
    city: "Indianapolis",
    region: "IN",
    postalCode: "46204",
    timezone: INDY,
    units: [
      {
        id: null,
        label: "A",
        status: "occupied",
        rent: "$1,250",
        leaseEnd: "2027-06-30",
      },
      { id: null, label: "B", status: "vacant", rent: "", leaseEnd: "" },
    ],
    ...overrides,
  };
}

function errorsOf(input: unknown) {
  const result = validateBuilding(input);
  if (result.ok) throw new Error("Expected the form to be refused.");

  return result.errors;
}

function valuesOf(input: unknown) {
  const result = validateBuilding(input);
  if (!result.ok) {
    throw new Error(
      `Expected the form to pass: ${JSON.stringify(result.errors)}`,
    );
  }

  return result.values;
}

describe("validateBuilding", () => {
  it("turns a plain duplex into the values the database holds", () => {
    expect(valuesOf(duplex())).toEqual({
      label: null,
      addressLine1: "412 N Delaware St",
      addressLine2: null,
      city: "Indianapolis",
      region: "IN",
      postalCode: "46204",
      timezone: INDY,
      buildYear: null,
      acquiredOn: null,
      inServiceOn: null,
      purchasePriceCents: null,
      closingCostsCents: null,
      landBasisCents: null,
      buildingBasisCents: null,
      basisSplitMethod: null,
      basisSplitNote: null,
      units: [
        {
          id: null,
          label: "A",
          status: "occupied",
          rentCents: 125_000,
          leaseEnd: "2027-06-30",
        },
        {
          id: null,
          label: "B",
          status: "vacant",
          rentCents: null,
          leaseEnd: null,
        },
      ],
    });
  });

  it("trims what was typed, and stores an empty optional field as nothing", () => {
    const values = valuesOf(
      duplex({ label: "  The Delaware duplex ", addressLine2: "   " }),
    );

    expect(values.label).toBe("The Delaware duplex");
    expect(values.addressLine2).toBeNull();
  });

  it("reports every missing address field at once", () => {
    expect(
      errorsOf(
        duplex({ addressLine1: "", city: " ", region: "", postalCode: "" }),
      ),
    ).toEqual({
      addressLine1: "Enter the street address.",
      city: "Enter the city.",
      region: "Enter the state.",
      postalCode: "Enter the ZIP code.",
    });
  });

  it.each(["", "Indianapolis", "America/Nowhere"])(
    "refuses %j as a time zone",
    (timezone) => {
      expect(errorsOf(duplex({ timezone })).timezone).toBe(
        "Choose the time zone the building is in.",
      );
    },
  );

  describe("the year built", () => {
    it.each([
      ["1924", 1924],
      ["", null],
      [" 2026 ", 2026],
    ])("reads %j as %j", (buildYear, expected) => {
      expect(valuesOf(duplex({ buildYear })).buildYear).toBe(expected);
    });

    it.each(["24", "1924.5", "nineteen twenty-four", "1599", "2201", "1e3"])(
      "refuses %j",
      (buildYear) => {
        expect(errorsOf(duplex({ buildYear })).buildYear).toBe(
          "Enter the year as four digits, like 1924.",
        );
      },
    );
  });

  describe("units", () => {
    it("needs at least one", () => {
      expect(errorsOf(duplex({ units: [] })).units).toBe(
        "Add at least one unit.",
      );
    });

    it("does not count a retired unit as the one", () => {
      const units = [
        {
          id: "01936f8e-8b8a-7c3e-9b1a-2f4d5e6a7b8c",
          label: "A",
          status: "retired" as const,
          rent: "",
          leaseEnd: "",
        },
      ];

      expect(errorsOf(duplex({ units })).units).toBe("Add at least one unit.");
    });

    it("needs each one named, and named differently from the others", () => {
      const errors = errorsOf(
        duplex({
          units: [
            { id: null, label: "A", status: "vacant", rent: "", leaseEnd: "" },
            { id: null, label: " ", status: "vacant", rent: "", leaseEnd: "" },
            { id: null, label: "a", status: "vacant", rent: "", leaseEnd: "" },
          ],
        }),
      );

      // The first "A" is fine; the second is the one to rename.
      expect(errors["units.0.label"]).toBeUndefined();
      expect(errors["units.1.label"]).toBe(
        "Name the unit — A, Upstairs, Unit 2.",
      );
      expect(errors["units.2.label"]).toBe("Give each unit a different name.");
    });

    it("needs the rent of an occupied unit", () => {
      const [a, b] = duplex().units;

      expect(
        errorsOf(duplex({ units: [{ ...a!, rent: "" }, b!] }))["units.0.rent"],
      ).toBe("Enter the monthly rent, or mark the unit vacant.");
    });

    it("keeps a vacant unit's asking rent, and does not ask for one", () => {
      const [a, b] = duplex().units;

      expect(
        valuesOf(duplex({ units: [a!, { ...b!, rent: "1,195" }] })).units[1]
          ?.rentCents,
      ).toBe(119_500);
      expect(valuesOf(duplex()).units[1]?.rentCents).toBeNull();
    });

    it.each([
      ["12.50.1", "Enter an amount in dollars, like 1,250."],
      ["-1250", "Enter the amount without a minus sign."],
      [
        "1,250.005",
        "Enter the amount to the cent — two decimal places at most.",
      ],
    ])("says what to change about a rent of %j", (rent, message) => {
      const [a, b] = duplex().units;

      expect(
        errorsOf(duplex({ units: [{ ...a!, rent }, b!] }))["units.0.rent"],
      ).toBe(message);
    });

    it("refuses a lease end that is not a whole date", () => {
      const [a, b] = duplex().units;

      expect(
        errorsOf(duplex({ units: [{ ...a!, leaseEnd: "2027-02-30" }, b!] }))[
          "units.0.leaseEnd"
        ],
      ).toBe("Enter the whole date — day, month and year.");
    });
  });

  describe("purchase and basis", () => {
    const BASIS = {
      purchasePrice: "$250,000",
      closingCosts: "4,200",
      landValue: "46,000",
    };

    it("stores none of it when none of it is entered", () => {
      const values = valuesOf(duplex());

      expect(values.purchasePriceCents).toBeNull();
      expect(values.landBasisCents).toBeNull();
      expect(values.buildingBasisCents).toBeNull();
    });

    it("computes the building's share from the other three", () => {
      const values = valuesOf(duplex(BASIS));

      expect(values.purchasePriceCents).toBe(25_000_000);
      expect(values.closingCostsCents).toBe(420_000);
      expect(values.landBasisCents).toBe(4_600_000);
      // 250,000 + 4,200 − 46,000: `buildings_basis_complete`'s arithmetic.
      expect(values.buildingBasisCents).toBe(20_820_000);
    });

    it("keeps the cents exact on the way through", () => {
      const values = valuesOf(
        duplex({
          purchasePrice: "10,000.01",
          closingCosts: "",
          landValue: "0.02",
        }),
      );

      expect(values.closingCostsCents).toBeNull();
      expect(values.buildingBasisCents).toBe(999_999);
    });

    it("needs the price and the land once any of the three is entered", () => {
      expect(errorsOf(duplex({ closingCosts: "4,200" }))).toEqual({
        purchasePrice:
          "Enter the purchase price, or clear the other purchase figures.",
        landValue: "Enter the land value, or clear the other purchase figures.",
      });

      expect(
        errorsOf(duplex({ purchasePrice: "250,000" })).landValue,
      ).toBeDefined();
      expect(
        errorsOf(duplex({ landValue: "46,000" })).purchasePrice,
      ).toBeDefined();
    });

    it("refuses land worth more than the price plus closing costs", () => {
      expect(
        errorsOf(duplex({ ...BASIS, landValue: "254,200.01" })).landValue,
      ).toBe("Enter a land value no more than the price plus closing costs.");

      // Exactly equal is a building worth nothing, which is a real answer.
      expect(
        valuesOf(duplex({ ...BASIS, landValue: "254,200" })).buildingBasisCents,
      ).toBe(0);
    });

    it("gives an amount that is not one its own message, and only that", () => {
      // Not also "enter the purchase price": it was entered, wrongly.
      expect(errorsOf(duplex({ ...BASIS, purchasePrice: "lots" }))).toEqual({
        purchasePrice: "Enter an amount in dollars, like 1,250.",
      });
    });

    it("stores the split's method and its note", () => {
      const values = valuesOf(
        duplex({
          ...BASIS,
          basisSplitMethod: "assessment_ratio",
          basisSplitNote: " 2026 Marion County assessment ",
        }),
      );

      expect(values.basisSplitMethod).toBe("assessment_ratio");
      expect(values.basisSplitNote).toBe("2026 Marion County assessment");
    });

    it("places the building in service the day it was acquired, unless told otherwise", () => {
      expect(valuesOf(duplex({ acquiredOn: "2019-06-14" })).inServiceOn).toBe(
        "2019-06-14",
      );
      expect(
        valuesOf(
          duplex({ acquiredOn: "2019-06-14", inServiceOn: "2019-08-01" }),
        ).inServiceOn,
      ).toBe("2019-08-01");
    });

    it("refuses a building in service before it was acquired", () => {
      expect(
        errorsOf(
          duplex({ acquiredOn: "2019-06-14", inServiceOn: "2019-06-13" }),
        ).inServiceOn,
      ).toBe("Enter a date on or after the day it was acquired.");
    });
  });

  describe("a submission the form could not have made", () => {
    it.each([
      ["nothing", undefined],
      ["a string", "412 N Delaware St"],
      ["a missing field", { ...duplex(), city: undefined }],
      [
        "a unit status that does not exist",
        {
          ...duplex(),
          units: [{ ...duplex().units[0], status: "demolished" }],
        },
      ],
      [
        "a unit id that is not one",
        {
          ...duplex(),
          units: [{ ...duplex().units[0], id: "1" }],
        },
      ],
      [
        "a split method that does not exist",
        {
          ...duplex(),
          basisSplitMethod: "vibes",
        },
      ],
      [
        "an address longer than any address",
        {
          ...duplex(),
          addressLine1: "x".repeat(501),
        },
      ],
    ])("refuses %s with the one message", (_, input) => {
      expect(errorsOf(input)).toEqual({ form: UNREADABLE_FORM });
    });
  });
});

describe("buildingValue", () => {
  it("is shown as soon as the price and the land are", () => {
    expect(
      buildingValue({
        purchasePrice: "250,000",
        closingCosts: "",
        landValue: "46,000",
      }),
    ).toBe(20_400_000);
  });

  it("is nothing while a figure is missing, wrong, or makes it negative", () => {
    for (const fields of [
      { purchasePrice: "250,000", closingCosts: "", landValue: "" },
      { purchasePrice: "250,000", closingCosts: "lots", landValue: "46,000" },
      { purchasePrice: "250,000", closingCosts: "", landValue: "300,000" },
    ]) {
      expect(buildingValue(fields)).toBeNull();
    }
  });
});

describe("moneyField", () => {
  it("prefills an amount exactly, so an untouched save writes it back", () => {
    expect(moneyField(125_000)).toBe("$1,250");
    expect(moneyField(850)).toBe("$8.50");
    expect(moneyField(0)).toBe("$0");
    expect(moneyField(null)).toBe("");
  });
});

describe("buildingFields", () => {
  it("round-trips: a stored building, prefilled and saved unchanged, is the same building", () => {
    const stored = valuesOf(
      duplex({
        label: "The Delaware duplex",
        buildYear: "1924",
        acquiredOn: "2019-06-14",
        inServiceOn: "2019-08-01",
        purchasePrice: "250,000.50",
        closingCosts: "4,200",
        landValue: "46,000",
        basisSplitMethod: "appraisal",
      }),
    );
    const { units, ...building } = stored;
    const withIds = units.map((unit, index) => ({
      ...unit,
      id: `01936f8e-8b8a-7c3e-9b1a-2f4d5e6a7b8${index}`,
    }));

    expect(valuesOf(buildingFields(building, withIds))).toEqual({
      ...stored,
      units: withIds,
    });
  });
});

describe("nextUnitLabel", () => {
  it.each([
    [["A"], "B"],
    [["A", "B", "C"], "D"],
    [["a"], "b"],
    [["Unit 2"], "Unit 3"],
    [["1", "2"], "3"],
    [["Apt 9"], "Apt 10"],
  ])("continues %j with %j", (labels, next) => {
    expect(nextUnitLabel(labels)).toBe(next);
  });

  it.each([
    [[], ""],
    [["Upstairs"], ""],
    [["Z"], ""],
    // B is already taken, so the guess would collide rather than help.
    [["B", "A"], ""],
  ])("leaves %j's next row empty", (labels, next) => {
    expect(nextUnitLabel(labels)).toBe(next);
  });
});
