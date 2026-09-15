/**
 * Which part of a building a row belongs to: `Shared`, or a unit's label
 * (`docs/ui/components.md` §6, `docs/ui/screens/README.md`, building or unit).
 * **Written, never only coloured** — the word is the whole signal.
 *
 * The caller decides whether to render one: a single-unit building shows no
 * scope anywhere, because with one unit the distinction changes nothing.
 */
export function ScopeLabel({ children }: { children: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-sm border border-border-card px-1.5 py-px text-2xs leading-tight font-normal text-text-tertiary">
      {children}
    </span>
  );
}
