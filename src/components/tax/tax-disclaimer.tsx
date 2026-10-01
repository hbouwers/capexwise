/**
 * The planning-aid-not-advice notice (`docs/ui/components.md` §6,
 * `docs/ui/screens/tax-planner.md`, The disclaimer). **First on every tax
 * surface, above every figure, never dismissible or collapsible, and it
 * prints** — so it has no state, no close control, and no print rule hiding
 * it. PRD F4 calls the wording a requirement, not a nicety.
 *
 * The wording is the spec's placeholder until #38 settles it.
 */
export function TaxDisclaimer() {
  return (
    <aside
      aria-label="Not tax advice"
      className="rounded-lg border border-border-card bg-tint-warning px-4 py-3 text-sm leading-normal text-text-primary"
    >
      <strong className="font-semibold">
        Planning estimates, not tax advice.
      </strong>{" "}
      These figures are projections from what you have entered, and the
      repair-or-improvement calls are yours to confirm with a CPA before you
      file.
    </aside>
  );
}
