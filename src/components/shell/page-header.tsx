import type { ReactNode } from "react";

/**
 * The bar at the top of every screen: a title, a subtitle, and the screen's own
 * actions (`docs/ui/components.md` §4). Rendered by each page rather than by the
 * layout, because the strings are the page's — #12 owes the pair for every
 * screen — and a layout that had to be told them would need the page to reach
 * back up the tree to say so.
 *
 * **Sticky from `lg` up, and in the flow below it.** On a wide screen this is
 * the one bar pinned to the top, as the prototype draws it: translucent page
 * surface and a blur over a 1px border, never a shadow (tokens §8). Below `lg`
 * the mobile bar in `AppShell` is the pinned one, and two stacked sticky bars
 * would spend a quarter of a phone's height on chrome — so this scrolls away
 * with the content, and the menu stays reachable.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-border-card px-5 py-4 lg:sticky lg:top-0 lg:z-10 lg:h-(--header-height) lg:flex-row lg:items-center lg:justify-between lg:bg-surface-page/90 lg:px-8.5 lg:py-0 lg:backdrop-blur-sm">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="truncate text-lg leading-tight font-semibold text-text-primary">
          {title}
        </h1>
        <p className="truncate text-xs leading-tight text-text-muted">
          {subtitle}
        </p>
      </div>

      {actions ? (
        <div className="flex flex-wrap items-center gap-2.5">{actions}</div>
      ) : null}
    </header>
  );
}

/**
 * The content column under the header. The prototype's `30px 34px 70px`, kept
 * from `lg` up; below that the sides come in to the 20px the mobile bar and the
 * header use, so the three edges line up.
 */
export function PageBody({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 px-5 pt-6 pb-12 lg:px-8.5 lg:pt-7.5 lg:pb-17.5">
      {children}
    </div>
  );
}
