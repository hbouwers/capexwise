import { describe, expect, it } from "vitest";

import { MAX_CODE_BYTES } from "@/lib/access-code-cipher.mts";
import {
  accessCodeName,
  ACCOUNT_KINDS,
  ownerPaidMonthlyCents,
  SERVICE_KINDS,
} from "@/lib/building-facts";
import {
  buildingFactsFields,
  type BuildingFactsFields,
  emptyAccessCodeFields,
  emptyUtilityFields,
  MAX_CODE_LENGTH,
  validateBuildingFacts,
} from "@/lib/building-facts-form";
import { UNREADABLE_FORM } from "@/lib/forms";

const STORED_CODE = "0192f0c4-5b1e-7c3a-9d2e-4f6a8b0c1d2e";
const UNIT = "0192f0c4-5b1e-7c3a-9d2e-4f6a8b0c1d2f";

function form(
  overrides: Partial<BuildingFactsFields> = {},
): BuildingFactsFields {
  return {
    trashDay: "",
    recyclingDay: "",
    recyclingNote: "",
    accessCodes: [],
    utilities: [],
    ...overrides,
  };
}

describe("ownerPaidMonthlyCents", () => {
  it("adds the owner's bills and leaves the tenant's out", () => {
    // The card lists both and totals one: $186 electric and $64 water are
    // the owner's, and unit B's $92 gas is the tenant's.
    expect(
      ownerPaidMonthlyCents([
        { paidBy: "owner", avgMonthlyCents: 18_600 },
        { paidBy: "tenant", avgMonthlyCents: 9_200 },
        { paidBy: "owner", avgMonthlyCents: 6_400 },
      ]),
    ).toBe(25_000);
  });

  it("counts a bill nobody has entered as nothing, not as an error", () => {
    expect(
      ownerPaidMonthlyCents([
        { paidBy: "owner", avgMonthlyCents: null },
        { paidBy: "owner", avgMonthlyCents: 4_500 },
      ]),
    ).toBe(4_500);
    expect(ownerPaidMonthlyCents([])).toBe(0);
  });
});

describe("accessCodeName", () => {
  it("names a code by its label and kind, or its kind alone", () => {
    expect(accessCodeName({ label: "Rear door", kind: "door" })).toBe(
      "Rear door · door code",
    );
    expect(accessCodeName({ label: null, kind: "smart_lock" })).toBe(
      "Smart lock",
    );
  });
});

it("puts every utility kind in exactly one of the card's two groups", () => {
  expect([...SERVICE_KINDS, ...ACCOUNT_KINDS].sort()).toEqual(
    [
      "electric",
      "gas",
      "internet",
      "lawn",
      "other",
      "snow",
      "trash",
      "water_sewer",
    ].sort(),
  );
});

describe("validateBuildingFacts", () => {
  it("allows the cipher's longest code and no longer", () => {
    // The editor cannot import the cipher, which is `node:crypto`; this is
    // what keeps its limit the cipher's.
    expect(MAX_CODE_LENGTH).toBe(MAX_CODE_BYTES);
  });

  it("keeps a stored code when its field is left empty, and requires a new one's", () => {
    const result = validateBuildingFacts(
      form({
        accessCodes: [
          { ...emptyAccessCodeFields(), id: STORED_CODE },
          emptyAccessCodeFields(),
        ],
      }),
    );

    expect(result).toEqual({
      ok: false,
      errors: { "accessCodes.1.code": "Enter the code." },
    });
  });

  it("reads a code as typed, trimmed, and a stored one as kept", () => {
    const result = validateBuildingFacts(
      form({
        accessCodes: [
          { ...emptyAccessCodeFields(), id: STORED_CODE, label: "  " },
          {
            ...emptyAccessCodeFields(),
            kind: "lockbox",
            label: "Basement",
            unitId: UNIT,
            code: " 2280 ",
          },
        ],
      }),
    );

    expect(result.ok && result.values.accessCodes).toEqual([
      { id: STORED_CODE, kind: "door", label: null, unitId: null, code: null },
      {
        id: null,
        kind: "lockbox",
        label: "Basement",
        unitId: UNIT,
        code: "2280",
      },
    ]);
  });

  it("measures a code in bytes, as the cipher does", () => {
    // Sixty-three characters of ASCII fit; twenty-two euro signs are
    // sixty-six bytes and do not, though they are fewer characters.
    const fits = "1".repeat(63);
    const tooLong = "€".repeat(22);

    expect(
      validateBuildingFacts(
        form({ accessCodes: [{ ...emptyAccessCodeFields(), code: fits }] }),
      ).ok,
    ).toBe(true);
    expect(
      validateBuildingFacts(
        form({ accessCodes: [{ ...emptyAccessCodeFields(), code: tooLong }] }),
      ),
    ).toEqual({
      ok: false,
      errors: {
        "accessCodes.0.code": "Enter a code of 63 characters or fewer.",
      },
    });
  });

  it("refuses a whole account number, and takes the last four", () => {
    const electric = {
      ...emptyUtilityFields("electric"),
      providerName: "AES Indiana",
    };

    expect(
      validateBuildingFacts(
        form({ utilities: [{ ...electric, accountRef: "0012344192" }] }),
      ),
    ).toEqual({
      ok: false,
      errors: {
        "utilities.0.accountRef":
          "Enter only the last four characters of the account number.",
      },
    });

    const result = validateBuildingFacts(
      form({ utilities: [{ ...electric, accountRef: "4192" }] }),
    );
    expect(result.ok && result.values.utilities[0]?.accountRef).toBe("4192");
  });

  it("names an account by its provider, and a service by its provider or contact", () => {
    const result = validateBuildingFacts(
      form({
        utilities: [
          emptyUtilityFields("gas"),
          emptyUtilityFields("snow"),
          { ...emptyUtilityFields("lawn"), contactId: UNIT },
        ],
      }),
    );

    expect(result).toEqual({
      ok: false,
      errors: {
        "utilities.0.providerName":
          "Enter the provider — AES Indiana, Citizens Energy.",
        "utilities.1.providerName": "Enter the company, or choose a contact.",
      },
    });
  });

  it("reads an average bill into cents, and says what to change otherwise", () => {
    const water = {
      ...emptyUtilityFields("water_sewer"),
      providerName: "Citizens Energy",
    };

    const good = validateBuildingFacts(
      form({ utilities: [{ ...water, avgMonthly: "$64.50" }] }),
    );
    expect(good.ok && good.values.utilities[0]?.avgMonthlyCents).toBe(6_450);

    expect(
      validateBuildingFacts(
        form({ utilities: [{ ...water, avgMonthly: "-64" }] }),
      ),
    ).toEqual({
      ok: false,
      errors: {
        "utilities.0.avgMonthly": "Enter the amount without a minus sign.",
      },
    });
  });

  it("stores an unset day as nothing", () => {
    const result = validateBuildingFacts(
      form({ trashDay: "thu", recyclingNote: " every other week " }),
    );

    expect(result).toEqual({
      ok: true,
      values: {
        trashDay: "thu",
        recyclingDay: null,
        recyclingNote: "every other week",
        accessCodes: [],
        utilities: [],
      },
    });
  });

  it("refuses a submission the editor could not have made", () => {
    for (const input of [
      null,
      form({ trashDay: "thursday" as "thu" }),
      form({
        accessCodes: [{ ...emptyAccessCodeFields(), unitId: "not-a-unit" }],
      }),
    ]) {
      expect(validateBuildingFacts(input)).toEqual({
        ok: false,
        errors: { form: UNREADABLE_FORM },
      });
    }
  });
});

describe("buildingFactsFields", () => {
  it("never prefills a code, and prefills an average exactly", () => {
    const fields = buildingFactsFields({
      trashDay: "thu",
      recyclingDay: null,
      recyclingNote: null,
      accessCodes: [
        { id: STORED_CODE, kind: "door", label: "Rear door", unitId: null },
      ],
      utilities: [
        {
          id: STORED_CODE,
          kind: "gas",
          unitId: UNIT,
          providerName: "Citizens Energy",
          accountRef: "0021",
          paidBy: "tenant",
          avgMonthlyCents: 9_250,
          contact: null,
        },
      ],
    });

    expect(fields.accessCodes[0]?.code).toBe("");
    expect(fields.utilities[0]?.avgMonthly).toBe("$92.50");

    // And an untouched editor saves what it read.
    const saved = validateBuildingFacts(fields);
    expect(saved.ok && saved.values.utilities[0]?.avgMonthlyCents).toBe(9_250);
    expect(saved.ok && saved.values.accessCodes[0]?.code).toBeNull();
  });
});
