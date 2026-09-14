import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

/**
 * A tinted label (`docs/ui/components.md` §6). Five variants, each a
 * foreground and the tint it was measured against — mixing one variant's text
 * with another's tint is how a badge ends up failing contrast, so neither is
 * a prop on its own (tokens §3).
 *
 * The word is the signal. The colour repeats it for a reader who can see it;
 * nothing here is communicated by the tint alone.
 */
const VARIANTS = {
  good: "bg-tint-good text-status-good",
  warning: "bg-tint-warning text-status-warning",
  danger: "bg-tint-danger text-status-danger",
  overdue: "bg-tint-overdue text-status-overdue",
  neutral: "bg-tint-neutral text-status-neutral",
} as const;

export type StatusVariant = keyof typeof VARIANTS;

export function StatusBadge({
  variant,
  children,
  className,
}: {
  variant: StatusVariant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Badge className={cn("uppercase", VARIANTS[variant], className)}>
      {children}
    </Badge>
  );
}
