/**
 * Money is integer cents, and this is the one place it becomes anything else
 * (`CLAUDE.md`, ADR-0005). Three things live here: the formatter every figure
 * renders through, the parser every typed amount comes in through, and the
 * split that keeps an allocation summing to its total.
 *
 * **Rounding happens in `formatMoney` and nowhere else.** The forecast and the
 * tax planner add and split cents exactly, and round once, at display. A figure
 * rounded before it is summed is the ten-year forecast that disagrees with its
 * own total by a few dollars — ADR-0005's first rule.
 *
 * The type is `Cents` rather than `Money` because `Money` is the component
 * (`docs/ui/components.md` §6), and the two would collide in every file that
 * renders a figure — which is most of them.
 */

/**
 * A whole number of cents. `bigint` in the database, a `number` here: a
 * JavaScript number holds integers exactly up to 2^53, about $90 trillion, and
 * Drizzle reads the columns in `mode: "number"` for the reason
 * `src/db/schema/organizations.ts` gives.
 *
 * A plain alias, not a brand. Every sum and difference of two branded values
 * is a plain `number` again, so the forecast maths would be casts from end to
 * end. What stops a float getting through is the check at the two places cents
 * leave integer arithmetic — `formatMoney` and `splitCents` — which throw.
 */
export type Cents = number;

/**
 * - `dollars`: `$8,400`. The default, and what tables, tiles and statements
 *   show.
 * - `cents`: `$8,400.50`. Exact, so it is also what a form is prefilled with —
 *   prefilling `$8,400` would round the amount on the next save.
 * - `compact`: `$39.7k`. Chart labels and runway rows only, where the full
 *   figure is a click away, and **never on the tax planner**
 *   (`docs/ui/screens/README.md`, Money).
 */
export type MoneyForm = "dollars" | "cents" | "compact";

export type MoneyFormat = {
  form?: MoneyForm;
  /**
   * Render a plus on a positive figure — `+$44,800` — as well as the minus
   * every negative always gets. `DeltaValue`'s form. Zero takes neither.
   */
  signed?: boolean;
};

/**
 * U+2212, not the hyphen. It is the width of the plus in the mono, so a column
 * of signed figures stays aligned, and a screen reader reads it as "minus".
 */
const MINUS = "−";

/**
 * Only ever handed an integer, so it groups digits and does no rounding of its
 * own. A fixed locale: this is a US product, and a figure has to read the same
 * on the server and in every browser.
 */
const grouped = new Intl.NumberFormat("en-US");

/**
 * `$8,400`, `−$5,400`, `$39.7k`. Throws on anything that is not a whole number
 * of cents, because a dollar amount passed where cents belong renders a
 * hundredfold error that looks entirely plausible — ADR-0005's warning about
 * the raw value, from the other side.
 *
 * A negative always renders its sign, since `transactions.amount_cents` is
 * signed (`docs/data-model.md` §6). A figure that rounds to zero renders as
 * `$0` with no sign: `−$0` for a 30-cent shortfall states a direction the
 * figure beside it cannot show.
 *
 * Halves round away from zero, on the magnitude, so a refund and a charge of
 * the same size render the same digits.
 */
export function formatMoney(
  cents: Cents,
  { form = "dollars", signed = false }: MoneyFormat = {},
): string {
  assertCents(cents);

  const magnitude = Math.abs(cents);
  const digits =
    form === "cents"
      ? exact(magnitude)
      : form === "compact"
        ? compact(magnitude)
        : grouped.format(roundDiv(magnitude, 100));

  if (digits === "0" || digits === "0.00") return `$${digits}`;
  if (cents < 0) return `${MINUS}$${digits}`;

  return signed ? `+$${digits}` : `$${digits}`;
}

function exact(magnitude: number): string {
  const cents = magnitude % 100;

  return `${grouped.format((magnitude - cents) / 100)}.${String(cents).padStart(2, "0")}`;
}

/**
 * Whole dollars under $1,000, then one decimal of thousands or millions with a
 * trailing `.0` dropped: `$840`, `$39.7k`, `$40k`, `$1.2M`. Each step rounds
 * from the cents, not from the step below it, so $999,960 is `$1M` rather than
 * `$1000k`.
 */
function compact(magnitude: number): string {
  const dollars = roundDiv(magnitude, 100);
  if (dollars < 1_000) return String(dollars);

  const tenthsOfK = roundDiv(magnitude, 10_000);
  if (tenthsOfK < 10_000) return `${tenths(tenthsOfK)}k`;

  return `${tenths(roundDiv(magnitude, 10_000_000))}M`;
}

function tenths(n: number): string {
  const whole = grouped.format(Math.floor(n / 10));
  const tenth = n % 10;

  return tenth === 0 ? whole : `${whole}.${tenth}`;
}

/**
 * Integer division rounding half up, for a non-negative `n`. Built on `%`,
 * which is exact on integers, so the result never passes through a fraction.
 */
function roundDiv(n: number, d: number): number {
  const remainder = n % d;
  const quotient = (n - remainder) / d;

  return remainder * 2 >= d ? quotient + 1 : quotient;
}

function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) {
    throw new TypeError(
      `Expected a whole number of cents, got ${cents}. Money is integer cents (ADR-0005).`,
    );
  }
}

export type ParsedMoney =
  | { ok: true; cents: Cents }
  | {
      ok: false;
      /**
       * Distinguished so a form can say which: `8,400.505` deserves "amounts
       * are to the cent", not "enter a number".
       */
      reason: "empty" | "not-a-number" | "negative" | "fraction-of-a-cent";
    };

/**
 * Optional `$`, digits with the commas either all correct or absent, and up to
 * two decimals. `8400`, `8,400`, `$8,400.5` and `.50` are amounts; `8,40,0` is
 * not one with a stray comma, it is a typo, and so is `1e5`.
 */
const AMOUNT = /^\$?\s*(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d*))?$/;

/**
 * What a person typed, as cents — or the reason it is not an amount.
 *
 * **It refuses rather than rounds.** `8,400.505` is not `$8,400.51`; it is an
 * amount this product cannot store, and saying so is better than saving a
 * number the person did not type.
 *
 * Every amount a person enters is a magnitude — costs, prices, the reserve,
 * and expenses, which are typed positive beside a `Money out` / `Refund`
 * choice and stored signed (`docs/ui/screens/expenses.md`) — so a minus sign
 * is refused too.
 */
export function parseMoney(input: string): ParsedMoney {
  const text = input.trim();
  if (text === "") return { ok: false, reason: "empty" };
  if (/^[-−]/.test(text.replace(/^\$\s*/, ""))) {
    return { ok: false, reason: "negative" };
  }

  const match = AMOUNT.exec(text);
  if (!match) return { ok: false, reason: "not-a-number" };

  const whole = (match[1] ?? "").replaceAll(",", "");
  const fraction = match[2] ?? "";
  if (whole === "" && fraction === "") {
    return { ok: false, reason: "not-a-number" };
  }
  if (fraction.length > 2) return { ok: false, reason: "fraction-of-a-cent" };

  // Joined as digits and read once, so the amount is never a fractional number
  // on its way to being cents.
  const cents = Number(`${whole}${fraction.padEnd(2, "0")}`);
  if (!Number.isSafeInteger(cents)) {
    return { ok: false, reason: "not-a-number" };
  }

  return { ok: true, cents };
}

/**
 * Splits `total` in proportion to `weights` so that the parts sum to the total
 * exactly — the allocation rule in `docs/data-model.md` §5. $10,000.01 across
 * two units is `[500001, 500000]`, not two halves.
 *
 * Largest remainder: each part takes the floor of its exact share, and the
 * cents left over go one each to the parts with the largest fractional share.
 * Ties go to the earlier part, so the same inputs always give the same split;
 * callers pass units in a stable order.
 *
 * `weights` are what the rule stores: `1` per unit for `by_unit_count`, basis
 * points for `explicit`. A part with weight zero gets zero, never a leftover
 * cent. The arithmetic is `bigint`, so a large total times basis points cannot
 * lose precision.
 */
export function splitCents(total: Cents, weights: readonly number[]): Cents[] {
  assertCents(total);
  if (weights.length === 0) throw new RangeError("Nothing to split across.");
  for (const weight of weights) {
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw new RangeError(`Weights are non-negative integers, got ${weight}.`);
    }
  }

  const sum = weights.reduce((a, b) => a + BigInt(b), 0n);
  if (sum === 0n) throw new RangeError("Weights sum to zero.");

  // The magnitude is split and the sign put back, so a negative total splits
  // into the mirror image of the positive one.
  const magnitude = BigInt(Math.abs(total));
  const shares = weights.map((weight, index) => {
    const exact = magnitude * BigInt(weight);
    return { index, part: exact / sum, remainder: exact % sum };
  });

  let leftover = magnitude - shares.reduce((a, s) => a + s.part, 0n);
  const byRemainder = [...shares].sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (const share of byRemainder) {
    if (leftover === 0n) break;
    share.part += 1n;
    leftover -= 1n;
  }

  // Negated as a `bigint`, which has no negative zero to hand back.
  return shares.map((s) => Number(total < 0 ? -s.part : s.part));
}
