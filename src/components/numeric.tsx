import { cn } from "@/lib/cn";

/**
 * Any figure rendered as a value (`docs/ui/components.md` §6): IBM Plex Mono,
 * tabular figures, `--leading-none`. The mono rule is enforced by this
 * component rather than by discipline — a bare `{item.count}` in JSX is the
 * bug, and the one that slips is the one on the tax page.
 *
 * A number inside a sentence stays in the sentence's font ("built 1912", "25 yr
 * life"). This is for the number that *is* the value.
 *
 * Money goes through `Money`, which is built on this, so the formatter is never
 * skipped.
 */
export function Numeric({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <span className={cn("numeric", className)}>{children}</span>;
}
