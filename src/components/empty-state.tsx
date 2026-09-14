import type { ReactNode } from "react";

/**
 * What a list says when it has nothing in it (`docs/ui/components.md` §10):
 * a title, one line of why, and the one action that fixes it. The first real
 * org sees the empty version of every screen before any other, so this is the
 * first impression rather than an edge case.
 *
 * Not in the prototype, which has demo data everywhere.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-border-card bg-surface-card px-5 py-8 sm:items-center sm:px-8 sm:py-12 sm:text-center">
      <h2 className="text-md leading-tight font-semibold text-text-primary">
        {title}
      </h2>
      <p className="max-w-prose text-sm leading-normal text-text-tertiary">
        {body}
      </p>
      <div className="pt-1">{action}</div>
    </div>
  );
}
