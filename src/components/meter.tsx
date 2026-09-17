import { cn } from "@/lib/cn";

/**
 * A single-value bar (`docs/ui/components.md` §6): a `--meter-track` track and
 * a fill whose length is the value, 0 to 100. **Length is the encoding and
 * colour is redundant** (tokens §11), so it is hidden from assistive
 * technology and the caller always renders the value it stands for in text
 * beside it.
 */
export function Meter({
  percent,
  fill = "bg-meter-good",
  className,
}: {
  percent: number;
  /** One of the three meter fills; the good one unless the value is a warning. */
  fill?: "bg-meter-good" | "bg-meter-warn" | "bg-meter-bad";
  className?: string;
}) {
  const width = Math.min(100, Math.max(0, percent));

  return (
    <span
      aria-hidden
      className={cn(
        "block h-1.5 w-full overflow-hidden rounded-full bg-meter-track",
        className,
      )}
    >
      <span
        className={cn("block h-full rounded-full", fill)}
        style={{ width: `${width}%` }}
      />
    </span>
  );
}
