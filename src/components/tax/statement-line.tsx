"use client";

import { ChevronRightIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { cn } from "@/lib/cn";

/**
 * One line of the statement, or one timing lever, that opens to its inputs
 * (`docs/ui/screens/tax-planner.md`: "Every line is a disclosure"). This is
 * how PRD F4's traceability is met on the page: a `<button aria-expanded>`
 * whose panel holds the rows the figure was built from.
 *
 * The panel is rendered by the server and passed in, so this owns only
 * whether it is open.
 */
export function StatementLine({
  label,
  value,
  children,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((was) => !was)}
        className="flex w-full items-baseline justify-between gap-4 rounded-sm py-2.5 text-left text-sm transition-colors hover:bg-hover-fill"
      >
        <span className="flex min-w-0 items-baseline gap-1.5 text-text-secondary">
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 self-center text-text-muted transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="min-w-0">{label}</span>
        </span>
        <span className="shrink-0 text-text-primary">{value}</span>
      </button>
      <div
        id={panel}
        hidden={!open}
        className="pb-3 pl-5 text-xs leading-snug text-text-tertiary"
      >
        {children}
      </div>
    </div>
  );
}
