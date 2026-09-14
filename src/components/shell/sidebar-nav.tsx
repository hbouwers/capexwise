"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";

import { cn } from "@/lib/cn";

/**
 * The destinations, in the prototype's two groups — **Manage** and **Plan** —
 * with two departures from it, both deliberate:
 *
 * - **"Properties" is "Portfolio".** The prototype's first item opens the screen
 *   #12 calls `portfolio.md` and PRD F0 calls the portfolio dashboard: the five
 *   tiles above the building cards. "Property" is not a word this product uses
 *   for a building (CLAUDE.md), and "Buildings" would name half the screen.
 * - **"Property detail" is gone.** It was a nav item because the prototype had
 *   one building and no routing. A building's page is reached from its card;
 *   with more than one building, a nav entry for "the" building has nothing to
 *   point at.
 *
 * The Maintenance count badge (the prototype's overdue `3`) is not here yet:
 * it is a figure, and there are no tasks to count until F5.
 */
const NAV = [
  {
    label: "Manage",
    items: [
      { href: "/", label: "Portfolio" },
      { href: "/maintenance", label: "Maintenance" },
      { href: "/contacts", label: "Contact book" },
    ],
  },
  {
    label: "Plan",
    items: [
      { href: "/forecast", label: "CapEx forecast" },
      { href: "/tax", label: "Tax planner" },
    ],
  },
] as const;

/**
 * Whether `href` is the section `pathname` is in. The root matches only
 * itself — every path starts with `/`, so a prefix test would light Portfolio
 * up on every screen — and a building's pages, which are reached from its card
 * on the portfolio and have no nav entry of their own
 * (`docs/ui/screens/building-detail.md`).
 */
function isCurrent(pathname: string, href: string) {
  return href === "/"
    ? pathname === "/" || pathname.startsWith("/buildings/")
    : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * A client component for one reason: which item is current comes from the URL,
 * and `usePathname()` is how a component reads it without the layout
 * re-rendering on every navigation.
 *
 * Real links, not the prototype's click handlers on `<div>`s
 * (`docs/ui/components.md` §9) — so they are reachable by keyboard, open in a
 * new tab, and the current one says so to a screen reader with
 * `aria-current="page"` rather than only with colour.
 */
export function SidebarNav() {
  const pathname = usePathname();
  // The nav renders twice — in the rail and in the mobile drawer — so the ids
  // that label each group have to be unique per instance, not per group.
  const id = useId();

  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-3">
      {NAV.map((group, index) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          {/* A label rather than a heading: the nav comes before each page's
              h1 in the document, and a heading here would put two h2s ahead
              of it in every screen reader's outline. */}
          <p
            id={`${id}-${index}`}
            className={cn(
              "field-label px-2.5 pb-2",
              index === 0 ? "pt-2.5" : "pt-4",
            )}
          >
            {group.label}
          </p>

          <ul
            aria-labelledby={`${id}-${index}`}
            className="flex flex-col gap-0.5"
          >
            {group.items.map((item) => {
              const current = isCurrent(pathname, item.href);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-2.25 text-sm leading-none whitespace-nowrap transition-colors",
                      current
                        ? "bg-accent-fill font-medium text-accent"
                        : "text-text-secondary hover:bg-hover-fill",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.5 shrink-0 rounded-xs",
                        current ? "bg-accent" : "bg-border-hover",
                      )}
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
