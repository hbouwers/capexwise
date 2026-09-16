import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

/**
 * `ESTIMATED` or `AUDITED` (`docs/ui/components.md` §6): tokens §10's
 * six-property swap, of which a badge carries three — border, fill and text.
 * **The word is the signal.** The dashed border repeats it for a reader who
 * can see it, and does not survive a print or a screenshot on its own.
 *
 * The other half of the swap is the value's own text colour, which is the
 * caller's: `text-text-muted` beside an estimate, `text-text-primary` beside
 * an audited value.
 */
export function ConfidenceBadge({
  confidence,
  className,
}: {
  confidence: "estimated" | "audited";
  className?: string;
}) {
  return (
    <Badge
      className={cn(
        "uppercase",
        confidence === "audited"
          ? "border-accent-border bg-tint-good text-status-good"
          : // Not `estimated-border`: the badge's own `border` and
            // `border-transparent` come after it in the stylesheet and win,
            // leaving a solid, invisible border. The same three tokens as
            // classes `cn` knows are borders, so they replace the badge's.
            "border-dashed border-(length:--border-estimated-width) border-border-estimated bg-surface-card text-text-muted",
        className,
      )}
    >
      {confidence === "audited" ? "Audited" : "Estimated"}
    </Badge>
  );
}
