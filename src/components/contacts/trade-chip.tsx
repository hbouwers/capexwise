import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

/**
 * One trade (`docs/ui/components.md` §6): "filter chips and display chips are
 * the same chip in two states." Both are here, so the two cannot drift.
 *
 * **Display** — on a contact card, in the task modal: a quiet tag, in the
 * sans, because a trade is a word rather than a figure or a status.
 *
 * **Filter** — the contact book's row, and the scope filter the building page
 * will use: a `<button>` with `aria-pressed`, pill-shaped so a row of them
 * reads as a set of choices, with its count in the mono because a count is a
 * value. Pressed takes `--accent-fill`, which `tokens.md` names for exactly
 * this: the selected chip.
 */
export function TradeChip({ label }: { label: string }) {
  return (
    <Badge className="bg-surface-fill font-sans text-2xs font-normal tracking-normal text-text-secondary">
      {label}
    </Badge>
  );
}

export function TradeFilterChip({
  label,
  count,
  pressed,
  onClick,
}: {
  label: string;
  count: number;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs leading-tight whitespace-nowrap transition-colors",
        pressed
          ? "border-accent-border bg-accent-fill text-accent"
          : "border-border-control bg-surface-card text-text-secondary hover:border-hover-border",
      )}
    >
      {label}
      <span
        className={cn(
          "font-mono text-2xs tabular-nums",
          pressed ? "text-accent" : "text-text-muted",
        )}
      >
        {count}
      </span>
    </button>
  );
}
