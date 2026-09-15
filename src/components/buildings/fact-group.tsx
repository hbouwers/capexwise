import type { ReactNode } from "react";

/**
 * The facts card's label-over-value pairs (`docs/ui/components.md` §6): a
 * titled group, and a row per fact in it. Presentational — the card decides
 * what goes in each.
 *
 * A group is a `<dl>`, because a fact is a name and its value, and a screen
 * reader then says which is which. A group with nothing in it reads `Not
 * recorded` (`building-detail.md`, states), and the card's `Edit` is the way
 * to record it.
 */
export function FactGroup({
  title,
  empty,
  children,
}: {
  title: string;
  /** Said by the caller, which knows, rather than guessed from `children`. */
  empty: boolean;
  children?: ReactNode;
}) {
  const id = `facts-${title.toLowerCase().replaceAll(" ", "-")}`;

  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <h3 id={id} className="field-label">
        {title}
      </h3>
      {empty ? (
        <p className="text-sm leading-snug text-text-muted">Not recorded</p>
      ) : (
        <dl className="flex flex-col gap-3.5">{children}</dl>
      )}
    </section>
  );
}

export function FactRow({
  label,
  scope,
  value,
  note,
}: {
  label: string;
  /** A `ScopeLabel`, when the fact belongs to one unit of several. */
  scope?: ReactNode;
  value: ReactNode;
  /** A muted line under the value — `changed Mar 2026`, `tenant-paid`. */
  note?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="flex flex-wrap items-center gap-1.5 text-xs leading-snug text-text-muted">
        {label}
        {scope}
      </dt>
      <dd className="min-w-0 text-sm leading-snug text-text-primary">
        {value}
      </dd>
      {note ? (
        <dd className="text-2xs leading-snug text-text-muted">{note}</dd>
      ) : null}
    </div>
  );
}
