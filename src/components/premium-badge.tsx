import { Badge } from "@/components/ui/badge";

/**
 * The `PREMIUM` pip (`docs/ui/components.md` §6). Cosmetic: it labels a premium
 * surface and gates nothing — that is `PlanGate`'s job, and keeping them apart
 * is what lets this one sit on a button inside a client component.
 *
 * The warning pair, because the prototype's pip is amber text on an amber tint
 * and tokens §3 has exactly one amber pair that clears AA as text. A status
 * foreground only ever sits on its own tint.
 */
export function PremiumBadge() {
  return (
    <Badge className="bg-tint-warning text-status-warning uppercase">
      Premium
    </Badge>
  );
}
