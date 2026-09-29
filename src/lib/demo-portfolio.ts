/**
 * What the demo org holds (#34, ADR-0011): five Indianapolis buildings and
 * eight doors, their equipment, their upkeep, the vendors who do it, and the
 * last six months of rent.
 *
 * **Content, not reference data.** `docs/data-model.md` §6 draws the line: the
 * catalogue and the trades are seeded by migrations because every org needs
 * them, and this is one org's portfolio, written again every night by
 * `resetDemoOrg()` in `src/server/demo.ts`. Nothing here is a row yet — it has
 * no ids and no org, and refers to its own units and contacts by `key` — so
 * that the writer is the only code that knows how rows are stored.
 *
 * **Everything is placed relative to `today`.** A demo seeded with fixed dates
 * is right for a month: the overdue task stops being overdue, the rent roll's
 * current month runs out of rows, and the forecast's past-life furnace ages
 * into a different chart. So install years are ages, due dates are offsets,
 * and rent is the six months up to this one — which makes the demo on any
 * night look like it did on the night it was written.
 *
 * The portfolio is shaped to make each screen worth opening. The Hoyt Avenue
 * duplex is the building with a problem — four systems past life, the rest
 * close — so the forecast has a spike and the building flag has something to
 * say. Julian Avenue is the healthy one. Woodlawn has a vacant unit and a late
 * payment. Every name, company, phone number and address is invented; the
 * phone numbers are in the 555-01xx block reserved for fiction, and the email
 * domains are `.example`, which can receive nothing.
 */
import type { tasks } from "@/db/schema";
import {
  addDays,
  addMonths,
  type CalendarDate,
  firstOfMonth,
  formatDate,
  yearOf,
} from "@/lib/dates";
import { categoryForTrade, REPAIRS } from "@/lib/expenses";
import type { Cents } from "@/lib/money";

/** Every demo building's zone — the demo city is Indianapolis (CLAUDE.md). */
export const DEMO_TIME_ZONE = "America/Indiana/Indianapolis";

/** How many months of rent the rent roll holds, this one included. */
export const DEMO_RENT_MONTHS = 6;

export type DemoContact = {
  key: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  rateNote: string;
  /** Trade slugs, from `drizzle/0013_seed_trade_tags.sql`. */
  tags: readonly string[];
};

export type DemoUnit = {
  key: string;
  label: string;
  status: "occupied" | "vacant";
  rentCents: Cents | null;
  leaseEnd: CalendarDate | null;
  bedrooms: string;
  bathrooms: string;
  squareFeet: number;
};

export type DemoItem = {
  /** A slug from `drizzle/0020_seed_capital_item_types.sql`. */
  typeSlug: string;
  label: string;
  installYear: number;
  /** Set exactly when the item is audited — `capital_items_audited_has_date`. */
  installDate: CalendarDate | null;
  expectedLifeYears: number;
  replacementCostCents: Cents;
  /** A unit's own item. Absent, it is the building's, shared by unit count. */
  unit?: string;
  /** The item this one replaced, kept as history. */
  replaced?: { installYear: number; actualCostCents: Cents | null };
  /**
   * Years after this one its next replacement is planned for (#96), so the
   * forecast has a plan to show beside a projection.
   */
  plannedIn?: number;
};

export type DemoTask = {
  title: string;
  notes: string | null;
  tradeTag: string;
  status: (typeof tasks.$inferInsert)["status"];
  priority: (typeof tasks.$inferInsert)["priority"];
  dueDate: CalendarDate | null;
  completedOn: CalendarDate | null;
  confirmedOn: CalendarDate | null;
  estCostCents: Cents | null;
  actualCostCents: Cents | null;
  recurrenceMonths: number | null;
  unit?: string;
  contact?: string;
};

export type DemoRentPeriod = {
  unit: string;
  periodMonth: CalendarDate;
  amountExpectedCents: Cents;
  amountReceivedCents: Cents | null;
  receivedOn: CalendarDate | null;
};

export type DemoBuilding = {
  label: string | null;
  addressLine1: string;
  city: string;
  region: string;
  postalCode: string;
  buildYear: number;
  basis: {
    acquiredOn: CalendarDate;
    purchasePriceCents: Cents;
    closingCostsCents: Cents;
    landBasisCents: Cents;
    buildingBasisCents: Cents;
  } | null;
  units: readonly DemoUnit[];
  facts: {
    trashDay: "mon" | "tue" | "wed" | "thu" | "fri";
    recyclingDay: "mon" | "tue" | "wed" | "thu" | "fri";
    recyclingNote: string | null;
    notes: string | null;
  };
  utilities: readonly {
    kind:
      | "gas"
      | "electric"
      | "water_sewer"
      | "internet"
      | "trash"
      | "lawn"
      | "snow";
    providerName: string;
    accountRef: string | null;
    paidBy: "owner" | "tenant";
    avgMonthlyCents: Cents | null;
    contact?: string;
  }[];
  accessCodes: readonly {
    kind: "smart_lock" | "door" | "lockbox" | "garage";
    label: string;
    code: string;
    unit?: string;
  }[];
  items: readonly DemoItem[];
  tasks: readonly DemoTask[];
  rent: readonly DemoRentPeriod[];
};

export type DemoPortfolio = {
  orgName: string;
  reserve: {
    balanceCents: Cents;
    asOf: CalendarDate;
    monthlyContributionCents: Cents;
  };
  contacts: readonly DemoContact[];
  buildings: readonly DemoBuilding[];
};

const CONTACTS: readonly DemoContact[] = [
  {
    key: "kilbride",
    name: "Dennis Kilbride",
    company: "Kilbride Handyman Services",
    phone: "317-555-0114",
    email: "dennis@kilbride.example",
    rateNote: "$75 / hr",
    tags: ["handyman", "painter"],
  },
  {
    key: "ruiz",
    name: "Ana Ruiz",
    company: "Ruiz Mechanical",
    phone: "317-555-0139",
    email: "ana@ruizmechanical.example",
    rateNote: "$145 diagnostic",
    tags: ["hvac"],
  },
  {
    key: "feeney",
    name: "Tom Feeney",
    company: "Feeney Plumbing & Heating",
    phone: "317-555-0166",
    email: "tom@feeneyph.example",
    rateNote: "$130 / hr",
    tags: ["plumber", "hvac"],
  },
  {
    key: "nair",
    name: "Priya Nair",
    company: "Nair Electric",
    phone: "317-555-0155",
    email: "priya@nairelectric.example",
    rateNote: "$110 / hr",
    tags: ["electrician"],
  },
  {
    key: "sutton",
    name: "Colby Sutton",
    company: "Sutton Building Co.",
    phone: "317-555-0121",
    email: "colby@suttonbuild.example",
    rateNote: "Bid basis",
    tags: ["general-contractor", "roofer"],
  },
  {
    key: "delgado",
    name: "Rosa Delgado",
    company: "Delgado Pest Solutions",
    phone: "317-555-0198",
    email: "rosa@delgadopest.example",
    rateNote: "$180 initial",
    tags: ["pest-control"],
  },
  {
    key: "vega",
    name: "Marco Vega",
    company: "Vega Landscaping",
    phone: "317-555-0182",
    email: "marco@vegalandscape.example",
    rateNote: "$65 / visit",
    tags: ["landscaper", "snow-removal"],
  },
  {
    key: "barrera",
    name: "Luis Barrera",
    company: "Barrera Turnover Cleaning",
    phone: "317-555-0190",
    email: "luis@barreraclean.example",
    rateNote: "$240 / unit",
    tags: ["turnover-cleaner"],
  },
  {
    key: "marchetti",
    name: "Ed Marchetti",
    company: "Marchetti Chimney & Vent",
    phone: "317-555-0129",
    email: "ed@marchettichimney.example",
    rateNote: "$180 / visit",
    tags: ["chimney", "appliance-repair"],
  },
  {
    key: "bell",
    name: "Kurt Bell",
    company: "Bell Locksmith",
    phone: "317-555-0111",
    email: "kurt@belllock.example",
    rateNote: "$95 trip fee",
    tags: ["locksmith"],
  },
  {
    key: "whitaker",
    name: "Jen Whitaker",
    company: "Circle City Leasing",
    phone: "317-555-0173",
    email: "jen@circlecityleasing.example",
    rateNote: "One month's rent",
    tags: ["realtor"],
  },
  {
    key: "lin",
    name: "Grace Lin",
    company: "Lin & Co. CPA",
    phone: "317-555-0102",
    email: "grace@lincpa.example",
    rateNote: "$2,400 / yr",
    tags: ["cpa"],
  },
  {
    key: "halper",
    name: "Nadia Halper",
    company: "Halper Law",
    phone: "317-555-0158",
    email: "nadia@halperlaw.example",
    rateNote: "$325 / hr",
    tags: ["attorney"],
  },
  {
    key: "pratt",
    name: "Owen Pratt",
    company: "Pratt Home Inspection",
    phone: "317-555-0164",
    email: "owen@prattinspect.example",
    rateNote: "$550 / inspection",
    tags: ["inspector"],
  },
];

/**
 * A scheduled task due `days` from today, or an overdue one when negative.
 * `recurrenceMonths` is one of `FREQUENCIES`, or null for a one-off booking.
 */
function upkeep(
  today: CalendarDate,
  days: number,
  task: Pick<DemoTask, "title" | "notes" | "tradeTag" | "estCostCents"> &
    Partial<DemoTask> & { recurrenceMonths: number | null },
): DemoTask {
  return {
    status: "scheduled",
    priority: days < 0 ? "high" : "normal",
    dueDate: addDays(today, days),
    completedOn: null,
    confirmedOn: null,
    actualCostCents: null,
    ...task,
  };
}

/** A one-off job finished `daysAgo` days ago, at what it cost. */
function finished(
  today: CalendarDate,
  daysAgo: number,
  task: Pick<DemoTask, "title" | "notes" | "tradeTag" | "actualCostCents"> &
    Partial<DemoTask>,
): DemoTask {
  const completedOn = addDays(today, -daysAgo);

  return {
    status: "done",
    priority: "normal",
    dueDate: completedOn,
    completedOn,
    confirmedOn: null,
    estCostCents: task.actualCostCents,
    recurrenceMonths: null,
    ...task,
  };
}

/** Work that is known about and not yet booked. */
function someday(
  task: Pick<DemoTask, "title" | "notes" | "tradeTag" | "estCostCents"> &
    Partial<DemoTask>,
): DemoTask {
  return {
    status: "unscheduled",
    priority: "low",
    dueDate: null,
    completedOn: null,
    confirmedOn: null,
    actualCostCents: null,
    recurrenceMonths: null,
    ...task,
  };
}

/** An estimated item installed `age` years ago. */
function estimated(
  year: number,
  age: number,
  item: Omit<DemoItem, "installYear" | "installDate">,
): DemoItem {
  return { ...item, installYear: year - age, installDate: null };
}

/**
 * An audited item: installed on a date somebody has a receipt for, in the
 * spring of the year `age` years ago.
 */
function audited(
  year: number,
  age: number,
  item: Omit<DemoItem, "installYear" | "installDate">,
): DemoItem {
  const installYear = year - age;

  return { ...item, installYear, installDate: `${installYear}-04-15` };
}

/**
 * Six months of rent for each occupied unit, received on the unit's usual day
 * — except where `late` names the unit, whose current month has not arrived.
 * A month whose usual day has not come yet this month is left unmarked, which
 * is what the rent roll shows for money nobody has said arrived.
 */
function rentFor(
  today: CalendarDate,
  units: readonly DemoUnit[],
  paidOnDay: Record<string, number>,
  late?: string,
): DemoRentPeriod[] {
  const current = firstOfMonth(today);
  const rows: DemoRentPeriod[] = [];

  for (const unit of units) {
    if (unit.status !== "occupied" || unit.rentCents === null) continue;

    for (let back = DEMO_RENT_MONTHS - 1; back >= 0; back--) {
      const periodMonth = addMonths(current, -back);
      const receivedOn = addDays(periodMonth, (paidOnDay[unit.key] ?? 1) - 1);
      const arrived = receivedOn <= today && !(back === 0 && unit.key === late);

      rows.push({
        unit: unit.key,
        periodMonth,
        amountExpectedCents: unit.rentCents,
        amountReceivedCents: arrived ? unit.rentCents : null,
        receivedOn: arrived ? receivedOn : null,
      });
    }
  }

  return rows;
}

/** The lease a unit is on: renewing within the year, on a month boundary. */
function leaseEnding(today: CalendarDate, months: number): CalendarDate {
  return addDays(addMonths(today, months), -1);
}

export function demoPortfolio(today: CalendarDate): DemoPortfolio {
  const year = yearOf(today);

  const hoytUnits: DemoUnit[] = [
    {
      key: "hoyt-upper",
      label: "Upper",
      status: "occupied",
      rentCents: 125_000,
      leaseEnd: leaseEnding(today, 4),
      bedrooms: "2",
      bathrooms: "1",
      squareFeet: 980,
    },
    {
      key: "hoyt-lower",
      label: "Lower",
      status: "occupied",
      rentCents: 130_000,
      leaseEnd: leaseEnding(today, 9),
      bedrooms: "2",
      bathrooms: "1",
      squareFeet: 1_040,
    },
  ];
  const julianUnits: DemoUnit[] = [
    {
      key: "julian",
      label: "House",
      status: "occupied",
      rentCents: 165_000,
      leaseEnd: leaseEnding(today, 7),
      bedrooms: "3",
      bathrooms: "2",
      squareFeet: 1_560,
    },
  ];
  const woodlawnUnits: DemoUnit[] = [
    {
      key: "woodlawn-1",
      label: "1",
      status: "occupied",
      rentCents: 102_500,
      leaseEnd: leaseEnding(today, 2),
      bedrooms: "2",
      bathrooms: "1",
      squareFeet: 860,
    },
    {
      key: "woodlawn-2",
      label: "2",
      status: "occupied",
      rentCents: 102_500,
      leaseEnd: leaseEnding(today, 11),
      bedrooms: "2",
      bathrooms: "1",
      squareFeet: 860,
    },
    {
      key: "woodlawn-3",
      label: "3",
      status: "vacant",
      rentCents: null,
      leaseEnd: null,
      bedrooms: "1",
      bathrooms: "1",
      squareFeet: 640,
    },
  ];
  const evanstonUnits: DemoUnit[] = [
    {
      key: "evanston",
      label: "Unit 4",
      status: "occupied",
      rentCents: 145_000,
      leaseEnd: leaseEnding(today, 5),
      bedrooms: "2",
      bathrooms: "2.5",
      squareFeet: 1_320,
    },
  ];
  const shelbyUnits: DemoUnit[] = [
    {
      key: "shelby",
      label: "3B",
      status: "occupied",
      rentCents: 130_000,
      leaseEnd: leaseEnding(today, 8),
      bedrooms: "2",
      bathrooms: "1",
      squareFeet: 910,
    },
  ];

  return {
    orgName: "Demo — Circle City Rentals",
    reserve: {
      balanceCents: 1_840_000,
      asOf: firstOfMonth(today),
      monthlyContributionCents: 60_000,
    },
    contacts: CONTACTS,
    buildings: [
      {
        label: "The Hoyt duplex",
        addressLine1: "1418 Hoyt Avenue",
        city: "Indianapolis",
        region: "IN",
        postalCode: "46203",
        buildYear: 1912,
        basis: {
          acquiredOn: "2017-06-30",
          purchasePriceCents: 18_900_000,
          closingCostsCents: 420_000,
          landBasisCents: 3_860_000,
          buildingBasisCents: 15_460_000,
        },
        units: hoytUnits,
        facts: {
          trashDay: "tue",
          recyclingDay: "tue",
          recyclingNote: "Every other week — the blue cart",
          notes: "Main water shutoff is in the basement, northeast corner.",
        },
        utilities: [
          {
            kind: "water_sewer",
            providerName: "Citizens Energy Group",
            accountRef: "4471",
            paidBy: "owner",
            avgMonthlyCents: 9_800,
          },
          {
            kind: "gas",
            providerName: "Citizens Energy Group",
            accountRef: "8820",
            paidBy: "tenant",
            avgMonthlyCents: null,
          },
          {
            kind: "electric",
            providerName: "AES Indiana",
            accountRef: null,
            paidBy: "tenant",
            avgMonthlyCents: null,
          },
          {
            kind: "lawn",
            providerName: "Vega Landscaping",
            accountRef: null,
            paidBy: "owner",
            avgMonthlyCents: 13_000,
            contact: "vega",
          },
        ],
        accessCodes: [
          { kind: "lockbox", label: "Back porch lockbox", code: "2468" },
          {
            kind: "smart_lock",
            label: "Upper front door",
            code: "718293",
            unit: "hoyt-upper",
          },
        ],
        items: [
          estimated(year, 17, {
            typeSlug: "furnace-gas",
            label: "Gas furnace, 80% AFUE",
            expectedLifeYears: 20,
            replacementCostCents: 480_000,
            unit: "hoyt-upper",
          }),
          estimated(year, 23, {
            typeSlug: "furnace-gas",
            label: "Gas furnace",
            expectedLifeYears: 20,
            replacementCostCents: 480_000,
            unit: "hoyt-lower",
          }),
          estimated(year, 16, {
            typeSlug: "central-ac",
            label: "Central AC condenser",
            expectedLifeYears: 15,
            replacementCostCents: 600_000,
          }),
          audited(year, 7, {
            typeSlug: "water-heater",
            label: "Water heater, 40 gal",
            expectedLifeYears: 10,
            replacementCostCents: 130_000,
            replaced: { installYear: year - 19, actualCostCents: null },
          }),
          // Two years past its life, and booked for next summer rather than
          // this winter: the forecast shows the plan beside the projection.
          audited(year, 22, {
            typeSlug: "roof-asphalt",
            label: "Roof, asphalt shingle",
            expectedLifeYears: 20,
            replacementCostCents: 1_050_000,
            plannedIn: 1,
          }),
          estimated(year, 34, {
            typeSlug: "windows",
            label: "Windows, 18 double-hung",
            expectedLifeYears: 30,
            replacementCostCents: 1_230_000,
          }),
          audited(year, 6, {
            typeSlug: "exterior-paint",
            label: "Exterior paint",
            expectedLifeYears: 8,
            replacementCostCents: 320_000,
          }),
          estimated(year, 8, {
            typeSlug: "refrigerator",
            label: "Refrigerator",
            expectedLifeYears: 10,
            replacementCostCents: 160_000,
            unit: "hoyt-upper",
          }),
          estimated(year, 11, {
            typeSlug: "refrigerator",
            label: "Refrigerator",
            expectedLifeYears: 10,
            replacementCostCents: 160_000,
            unit: "hoyt-lower",
          }),
          estimated(year, 9, {
            typeSlug: "carpet",
            label: "Carpet, bedrooms",
            expectedLifeYears: 7,
            replacementCostCents: 280_000,
            unit: "hoyt-lower",
          }),
        ],
        tasks: [
          upkeep(today, 13, {
            title: "Change HVAC air filters",
            notes: "20×25×1, both units",
            tradeTag: "hvac",
            estCostCents: 3_400,
            recurrenceMonths: 3,
          }),
          upkeep(today, -8, {
            title: "Chimney inspection and sweep",
            notes: "Lower unit fireplace",
            tradeTag: "chimney",
            estCostCents: 18_000,
            recurrenceMonths: 12,
            unit: "hoyt-lower",
            contact: "marchetti",
          }),
          upkeep(today, 34, {
            title: "HVAC service and coil clean",
            notes: "Before heating season",
            tradeTag: "hvac",
            estCostCents: 29_000,
            recurrenceMonths: 12,
            contact: "ruiz",
            confirmedOn: addDays(today, -3),
          }),
          upkeep(today, 51, {
            title: "Gutter cleaning",
            notes: "Full perimeter and downspouts",
            tradeTag: "handyman",
            estCostCents: 22_000,
            recurrenceMonths: 6,
            contact: "kilbride",
          }),
          someday({
            title: "Get a roof replacement bid",
            notes: "Two shingle tabs lifting on the south slope",
            tradeTag: "roofer",
            estCostCents: null,
            priority: "high",
            contact: "sutton",
          }),
          finished(today, 41, {
            title: "Replace kitchen faucet",
            notes: "Upper unit",
            tradeTag: "plumber",
            actualCostCents: 26_500,
            unit: "hoyt-upper",
            contact: "feeney",
          }),
          finished(today, 160, {
            title: "Service the furnaces",
            notes: "Both units",
            tradeTag: "hvac",
            actualCostCents: 31_000,
            contact: "ruiz",
          }),
        ],
        rent: rentFor(today, hoytUnits, { "hoyt-upper": 1, "hoyt-lower": 3 }),
      },
      {
        label: null,
        addressLine1: "5712 Julian Avenue",
        city: "Indianapolis",
        region: "IN",
        postalCode: "46219",
        buildYear: 1996,
        basis: {
          acquiredOn: "2021-03-12",
          purchasePriceCents: 22_400_000,
          closingCostsCents: 510_000,
          landBasisCents: 4_580_000,
          buildingBasisCents: 18_330_000,
        },
        units: julianUnits,
        facts: {
          trashDay: "thu",
          recyclingDay: "thu",
          recyclingNote: null,
          notes: null,
        },
        utilities: [
          {
            kind: "water_sewer",
            providerName: "Citizens Energy Group",
            accountRef: "1093",
            paidBy: "tenant",
            avgMonthlyCents: null,
          },
          {
            kind: "electric",
            providerName: "AES Indiana",
            accountRef: null,
            paidBy: "tenant",
            avgMonthlyCents: null,
          },
        ],
        accessCodes: [{ kind: "garage", label: "Garage keypad", code: "5501" }],
        items: [
          audited(year, 4, {
            typeSlug: "heat-pump",
            label: "Heat pump",
            expectedLifeYears: 15,
            replacementCostCents: 610_000,
          }),
          audited(year, 3, {
            typeSlug: "water-heater",
            label: "Water heater, 50 gal",
            expectedLifeYears: 10,
            replacementCostCents: 150_000,
          }),
          audited(year, 5, {
            typeSlug: "roof-asphalt",
            label: "Roof, architectural shingle",
            expectedLifeYears: 20,
            replacementCostCents: 1_120_000,
          }),
          estimated(year, 30, {
            typeSlug: "windows",
            label: "Windows",
            expectedLifeYears: 30,
            replacementCostCents: 1_230_000,
          }),
          estimated(year, 6, {
            typeSlug: "dishwasher",
            label: "Dishwasher",
            expectedLifeYears: 8,
            replacementCostCents: 120_000,
          }),
          estimated(year, 2, {
            typeSlug: "washer",
            label: "Washer",
            expectedLifeYears: 10,
            replacementCostCents: 90_000,
          }),
          estimated(year, 2, {
            typeSlug: "dryer",
            label: "Dryer",
            expectedLifeYears: 13,
            replacementCostCents: 90_000,
          }),
          estimated(year, 9, {
            typeSlug: "garage-door-opener",
            label: "Garage door opener",
            expectedLifeYears: 13,
            replacementCostCents: 40_000,
          }),
        ],
        tasks: [
          upkeep(today, 61, {
            title: "Test smoke and CO detectors",
            notes: "Six devices",
            tradeTag: "handyman",
            estCostCents: 0,
            recurrenceMonths: 6,
          }),
          upkeep(today, 102, {
            title: "Flush the water heater",
            notes: "Sediment",
            tradeTag: "plumber",
            estCostCents: 9_500,
            recurrenceMonths: 12,
            contact: "feeney",
          }),
          finished(today, 75, {
            title: "Termite inspection",
            notes: null,
            tradeTag: "pest-control",
            actualCostCents: 18_000,
            contact: "delgado",
          }),
        ],
        rent: rentFor(today, julianUnits, { julian: 1 }),
      },
      {
        label: "Woodlawn three-flat",
        addressLine1: "921 Woodlawn Avenue",
        city: "Indianapolis",
        region: "IN",
        postalCode: "46203",
        buildYear: 1949,
        basis: null,
        units: woodlawnUnits,
        facts: {
          trashDay: "mon",
          recyclingDay: "mon",
          recyclingNote: "Every other week",
          notes:
            "Shared laundry in the basement. Tenants have the side door code.",
        },
        utilities: [
          {
            kind: "water_sewer",
            providerName: "Citizens Energy Group",
            accountRef: "3310",
            paidBy: "owner",
            avgMonthlyCents: 14_600,
          },
          {
            kind: "gas",
            providerName: "Citizens Energy Group",
            accountRef: "3311",
            paidBy: "owner",
            avgMonthlyCents: 21_000,
          },
          {
            kind: "trash",
            providerName: "Republic Services",
            accountRef: null,
            paidBy: "owner",
            avgMonthlyCents: 4_800,
          },
          {
            kind: "snow",
            providerName: "Vega Landscaping",
            accountRef: null,
            paidBy: "owner",
            avgMonthlyCents: null,
            contact: "vega",
          },
        ],
        accessCodes: [
          { kind: "door", label: "Side door", code: "1949" },
          {
            kind: "lockbox",
            label: "Unit 3 showing lockbox",
            code: "3030",
            unit: "woodlawn-3",
          },
        ],
        items: [
          estimated(year, 28, {
            typeSlug: "boiler",
            label: "Boiler, gas",
            expectedLifeYears: 25,
            replacementCostCents: 590_000,
          }),
          audited(year, 9, {
            typeSlug: "roof-asphalt",
            label: "Roof, asphalt shingle",
            expectedLifeYears: 20,
            replacementCostCents: 1_380_000,
          }),
          estimated(year, 12, {
            typeSlug: "water-heater",
            label: "Water heater, 75 gal",
            expectedLifeYears: 10,
            replacementCostCents: 260_000,
          }),
          estimated(year, 11, {
            typeSlug: "washer",
            label: "Coin washer",
            expectedLifeYears: 10,
            replacementCostCents: 110_000,
          }),
          estimated(year, 11, {
            typeSlug: "dryer",
            label: "Coin dryer",
            expectedLifeYears: 13,
            replacementCostCents: 110_000,
          }),
          estimated(year, 3, {
            typeSlug: "vinyl-flooring",
            label: "LVP flooring",
            expectedLifeYears: 10,
            replacementCostCents: 330_000,
            unit: "woodlawn-1",
          }),
          estimated(year, 8, {
            typeSlug: "carpet",
            label: "Carpet",
            expectedLifeYears: 7,
            replacementCostCents: 250_000,
            unit: "woodlawn-2",
          }),
          estimated(year, 12, {
            typeSlug: "interior-paint",
            label: "Interior paint",
            expectedLifeYears: 15,
            replacementCostCents: 240_000,
            unit: "woodlawn-3",
          }),
          estimated(year, 6, {
            typeSlug: "sump-pump",
            label: "Sump pump",
            expectedLifeYears: 7,
            replacementCostCents: 50_000,
          }),
        ],
        tasks: [
          upkeep(today, -13, {
            title: "Dryer vent cleaning",
            notes: "Shared basement run",
            tradeTag: "appliance-repair",
            estCostCents: 14_000,
            recurrenceMonths: 12,
            contact: "marchetti",
          }),
          upkeep(today, 9, {
            title: "Turn over unit 3",
            notes: "Clean, patch and paint before showings",
            tradeTag: "turnover-cleaner",
            estCostCents: 24_000,
            recurrenceMonths: null,
            unit: "woodlawn-3",
            contact: "barrera",
            confirmedOn: addDays(today, -1),
          }),
          upkeep(today, 22, {
            title: "Quarterly pest treatment",
            notes: "Basement and exterior",
            tradeTag: "pest-control",
            estCostCents: 9_000,
            recurrenceMonths: 3,
            contact: "delgado",
          }),
          someday({
            title: "List unit 3",
            notes: "After turnover",
            tradeTag: "realtor",
            estCostCents: 102_500,
            priority: "high",
            unit: "woodlawn-3",
            contact: "whitaker",
          }),
          finished(today, 20, {
            title: "Rekey unit 3",
            notes: "Previous tenant moved out",
            tradeTag: "locksmith",
            actualCostCents: 16_500,
            unit: "woodlawn-3",
            contact: "bell",
          }),
        ],
        rent: rentFor(
          today,
          woodlawnUnits,
          { "woodlawn-1": 1, "woodlawn-2": 2 },
          "woodlawn-2",
        ),
      },
      {
        label: null,
        addressLine1: "6139 Evanston Avenue",
        city: "Indianapolis",
        region: "IN",
        postalCode: "46220",
        buildYear: 1988,
        basis: null,
        units: evanstonUnits,
        facts: {
          trashDay: "wed",
          recyclingDay: "wed",
          recyclingNote: null,
          notes: "HOA handles the roof, siding and snow.",
        },
        utilities: [
          {
            kind: "electric",
            providerName: "AES Indiana",
            accountRef: null,
            paidBy: "tenant",
            avgMonthlyCents: null,
          },
          {
            kind: "internet",
            providerName: "Metronet",
            accountRef: null,
            paidBy: "tenant",
            avgMonthlyCents: null,
          },
        ],
        accessCodes: [
          { kind: "smart_lock", label: "Front door", code: "604812" },
        ],
        items: [
          estimated(year, 18, {
            typeSlug: "furnace-gas",
            label: "Gas furnace",
            expectedLifeYears: 20,
            replacementCostCents: 480_000,
          }),
          estimated(year, 13, {
            typeSlug: "central-ac",
            label: "Central AC condenser",
            expectedLifeYears: 15,
            replacementCostCents: 600_000,
          }),
          estimated(year, 8, {
            typeSlug: "water-heater",
            label: "Water heater, 40 gal",
            expectedLifeYears: 10,
            replacementCostCents: 130_000,
          }),
          estimated(year, 12, {
            typeSlug: "range",
            label: "Range, gas",
            expectedLifeYears: 15,
            replacementCostCents: 120_000,
          }),
          estimated(year, 4, {
            typeSlug: "refrigerator",
            label: "Refrigerator",
            expectedLifeYears: 10,
            replacementCostCents: 160_000,
          }),
          estimated(year, 7, {
            typeSlug: "deck-wood",
            label: "Rear deck, pressure treated",
            expectedLifeYears: 20,
            replacementCostCents: 460_000,
          }),
        ],
        tasks: [
          upkeep(today, 250, {
            title: "Power wash and reseal the deck",
            notes: "240 sq ft",
            tradeTag: "painter",
            estCostCents: 41_000,
            recurrenceMonths: 12,
            contact: "kilbride",
          }),
          upkeep(today, 27, {
            title: "Change HVAC air filter",
            notes: "16×25×1",
            tradeTag: "hvac",
            estCostCents: 1_700,
            recurrenceMonths: 3,
          }),
        ],
        rent: rentFor(today, evanstonUnits, { evanston: 1 }),
      },
      {
        label: "Shelby Street condo",
        addressLine1: "2240 Shelby Street",
        city: "Indianapolis",
        region: "IN",
        postalCode: "46203",
        buildYear: 2004,
        basis: null,
        units: shelbyUnits,
        facts: {
          trashDay: "fri",
          recyclingDay: "fri",
          recyclingNote: "Building dumpsters, back lot",
          notes: "Condo association manages the common areas.",
        },
        utilities: [
          {
            kind: "electric",
            providerName: "AES Indiana",
            accountRef: null,
            paidBy: "tenant",
            avgMonthlyCents: null,
          },
        ],
        accessCodes: [{ kind: "door", label: "Lobby", code: "2240" }],
        items: [
          estimated(year, 7, {
            typeSlug: "heat-pump",
            label: "Heat pump",
            expectedLifeYears: 15,
            replacementCostCents: 610_000,
          }),
          estimated(year, 7, {
            typeSlug: "water-heater",
            label: "Water heater, 30 gal",
            expectedLifeYears: 10,
            replacementCostCents: 120_000,
          }),
          estimated(year, 5, {
            typeSlug: "dishwasher",
            label: "Dishwasher",
            expectedLifeYears: 8,
            replacementCostCents: 120_000,
          }),
          estimated(year, 3, {
            typeSlug: "vinyl-flooring",
            label: "LVP flooring",
            expectedLifeYears: 10,
            replacementCostCents: 290_000,
          }),
        ],
        tasks: [
          upkeep(today, 45, {
            title: "Clean the dishwasher filter and check the supply line",
            notes: null,
            tradeTag: "handyman",
            estCostCents: 0,
            recurrenceMonths: 6,
          }),
        ],
        rent: rentFor(today, shelbyUnits, { shelby: 4 }),
      },
    ],
  };
}

/**
 * One expense, as the demo writes it: signed, like the column (§6), and
 * pointing at its building's task by index and at its unit and contact by
 * key.
 */
export type DemoExpense = {
  occurredOn: CalendarDate;
  amountCents: Cents;
  description: string;
  category: string;
  classification: "unclassified" | null;
  unit?: string;
  contact?: string;
  /** The index into the building's `tasks` of the job it paid for. */
  task?: number;
};

/** The day of the month the demo's utility bills are paid on. */
const BILL_DAY = 15;

/**
 * A building's expenses (#142), **derived from what the content already
 * says** rather than written out beside it, so the ledger cannot disagree
 * with the tasks and the utilities it would otherwise repeat:
 *
 * - **Every finished job is its bill**, on the day it was done, filed by its
 *   trade (`categoryForTrade`) and linked to the task, its unit and its
 *   contact — which is what `Mark done` writes for a real one.
 * - **Every owner-paid utility with an average is a bill a month**, on the
 *   15th of each of the rent roll's months that has reached it, so the
 *   Cash flow tile and the expenses page cover the same months as the rent.
 * - **The first building's first finished job had a part returned**, three
 *   days later: one refund, so the ledger shows the sign going both ways.
 */
export function demoExpenses(
  today: CalendarDate,
  building: DemoBuilding,
  first: boolean,
): DemoExpense[] {
  const expenses: DemoExpense[] = [];

  building.tasks.forEach((task, index) => {
    if (task.status !== "done" || !task.completedOn || !task.actualCostCents) {
      return;
    }

    const category = categoryForTrade(task.tradeTag);
    expenses.push({
      occurredOn: task.completedOn,
      amountCents: -task.actualCostCents,
      description: task.title,
      category,
      classification: category === REPAIRS ? "unclassified" : null,
      unit: task.unit,
      contact: task.contact,
      task: index,
    });
  });

  if (first && expenses[0]) {
    const job = expenses[0];
    const returnedOn = addDays(job.occurredOn, 3);

    if (returnedOn <= today) {
      expenses.push({
        occurredOn: returnedOn,
        amountCents: Math.round(-job.amountCents / 10),
        description: "Returned an unused part",
        category: "supplies",
        classification: null,
        unit: job.unit,
      });
    }
  }

  const current = firstOfMonth(today);
  for (const utility of building.utilities) {
    if (utility.paidBy !== "owner" || utility.avgMonthlyCents === null) {
      continue;
    }

    for (let back = DEMO_RENT_MONTHS - 1; back >= 0; back--) {
      const occurredOn = addDays(addMonths(current, -back), BILL_DAY - 1);
      if (occurredOn > today) continue;

      expenses.push({
        occurredOn,
        amountCents: -utility.avgMonthlyCents,
        description: `${utility.providerName}, ${formatDate(occurredOn, "month")}`,
        category:
          utility.kind === "lawn" || utility.kind === "snow"
            ? "cleaning"
            : "utilities",
        classification: null,
        contact: utility.contact,
      });
    }
  }

  return expenses;
}
