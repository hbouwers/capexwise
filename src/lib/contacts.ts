/**
 * How the contact book orders its cards and which trades its filter offers
 * (`docs/ui/screens/contacts.md`). Small, and here rather than in the page so
 * the rules are the unit suite's to hold.
 */

/**
 * Names in the order a person reads them: "de la Cruz" beside "De Luca", not
 * after every capitalised name. A fixed locale for the reason `formatDate`
 * gives — the server and every browser must agree.
 */
const collator = new Intl.Collator("en-US", { sensitivity: "base" });

export function compareContactNames(a: string, b: string): number {
  return collator.compare(a, b);
}

export type TradeChoice = { slug: string; label: string };

/** One chip in the trade filter: a trade, and how many contacts carry it. */
export type TradeCount = TradeChoice & { count: number };

/**
 * The trades at least one contact has, in the trade list's own order, each
 * with its count. **Only the trades in use**: the prototype's nineteen chips,
 * most reading zero, are nineteen buttons that filter to nothing.
 */
export function tradesInUse(
  trades: readonly TradeChoice[],
  contacts: readonly { trades: readonly string[] }[],
): TradeCount[] {
  const counts = new Map<string, number>();

  for (const contact of contacts) {
    for (const slug of contact.trades) {
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
  }

  return trades
    .filter((trade) => counts.has(trade.slug))
    .map((trade) => ({ ...trade, count: counts.get(trade.slug) ?? 0 }));
}
