import type { ReactNode } from "react";

import { MobileNav } from "@/components/shell/mobile-nav";
import { Sidebar } from "@/components/shell/sidebar";
import type { OrgOption } from "@/server/org-context";

/**
 * The frame every signed-in screen renders inside (`docs/ui/components.md` §4):
 * the rail on the left, the screen on the right.
 *
 * **Two layouts, one breakpoint.** From `lg` (1024px) up it is the prototype's:
 * a 238px rail pinned to the viewport, and the page's own header pinned at the
 * top of the content column. Below `lg` the rail becomes a drawer behind a menu
 * button, in a bar that takes over as the pinned one — so there is exactly one
 * sticky bar at every width. `lg` is the breakpoint `grid-two-column` already
 * drops its rail at, so the shell and the screens inside it change shape at the
 * same width.
 *
 * Presentational: every prop is resolved by the layout, on the server, before
 * this renders (§8 — no component fetches its own data).
 */
export function AppShell({
  org,
  orgs,
  user,
  children,
}: {
  org: OrgOption;
  orgs: OrgOption[];
  user: { name: string; email: string };
  children: ReactNode;
}) {
  const sidebar = <Sidebar org={org} orgs={orgs} user={user} />;

  return (
    <div className="flex flex-1 bg-surface-page">
      {/* The first stop for a keyboard, ahead of the rail's links that every
          page repeats. Invisible until it has focus. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-surface-card focus:px-3 focus:py-2 focus:text-sm focus:text-text-primary"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh w-(--sidebar-width) flex-none border-r border-border-card bg-surface-card lg:block">
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-10 flex h-(--header-height) items-center gap-2 border-b border-border-card bg-surface-page/90 px-5 backdrop-blur-sm lg:hidden">
          {/* Keyed by org so a switch — which lands on `/`, the page it may
              well have been made from — remounts it closed. A link click
              closes it on its own; a menu choice inside it does not. */}
          <MobileNav key={org.id}>{sidebar}</MobileNav>
          <span className="truncate text-md leading-tight font-semibold text-text-primary">
            {org.name}
          </span>
        </div>

        <main id="main" className="flex flex-1 flex-col">
          {children}
        </main>
      </div>
    </div>
  );
}
