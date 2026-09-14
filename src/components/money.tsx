import { Numeric } from "@/components/numeric";
import { type Cents, type MoneyForm, formatMoney } from "@/lib/money";

/**
 * A figure in cents (`docs/ui/components.md` §6). Takes **integer cents** —
 * the prop is named for the unit so every call site says which it is passing —
 * and renders through the one formatter, which throws on anything else.
 *
 * `form="compact"` is for chart labels and runway rows only, and never the tax
 * planner (`docs/ui/screens/README.md`, Money).
 */
export function Money({
  cents,
  form,
  className,
}: {
  cents: Cents;
  form?: MoneyForm;
  className?: string;
}) {
  return (
    <Numeric className={className}>{formatMoney(cents, { form })}</Numeric>
  );
}

/**
 * A signed change in cents: `+$44,800`, `−$5,400`. The sign is always
 * rendered, because a minus survives a screenshot, a print and a colour-vision
 * difference that a red does not.
 *
 * It sets no colour. Where a screen colours a change — the reserve's lowest
 * point in `--status-danger` when it is negative — that is the screen's call,
 * passed as a class, and the sign is still there without it.
 */
export function DeltaValue({
  cents,
  className,
}: {
  cents: Cents;
  className?: string;
}) {
  return (
    <Numeric className={className}>
      {formatMoney(cents, { signed: true })}
    </Numeric>
  );
}
