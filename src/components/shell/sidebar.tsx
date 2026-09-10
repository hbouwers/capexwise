import Link from "next/link";

import { AccountMenu } from "@/components/shell/account-menu";
import { OrgSwitcher } from "@/components/shell/org-switcher";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import type { OrgOption } from "@/server/org-context";

/**
 * The reserve-health block at the foot of the rail (`docs/ui/components.md`
 * §4): in the prototype, a percentage and a meter over "$22.4k banked against
 * $39.7k due in 12 months".
 *
 * **It renders its empty state, because that is the true one.** Both halves of
 * the figure are forecast outputs — what is due comes from capital items (F2),
 * what is banked from a monthly contribution (F3) — and neither exists yet. A
 * placeholder percentage would be a number that traces to nothing, which the PRD
 * rules out anywhere a figure appears. So it says what it is waiting for, and
 * links to the screen that will own the number, as every figure here must.
 *
 * The populated version is F3's to add: the figure in `Numeric`, and a
 * `ReserveMeter` under it.
 */
function SidebarStat() {
  return (
    <Link
      href="/forecast"
      className="flex flex-col gap-2 rounded-lg border border-border-card bg-surface-subtle px-3.5 py-3.25 transition-colors hover:border-hover-border-card"
    >
      <span className="field-label">Reserve health</span>
      <span className="text-2xs leading-snug text-text-muted">
        Measured once the forecast has capital items and a monthly reserve
        contribution to set against them.
      </span>
    </Link>
  );
}

/**
 * What the rail holds, top to bottom: the org, the nav, and a footer with the
 * reserve and the account. One component rendered in two places — the fixed
 * rail from `lg` up, and the drawer below it — so the two cannot drift.
 */
export function Sidebar({
  org,
  orgs,
  user,
}: {
  org: OrgOption;
  orgs: OrgOption[];
  user: { name: string; email: string };
}) {
  return (
    <div className="flex h-full flex-col">
      <OrgSwitcher current={org} orgs={orgs} />

      <div className="flex-1 overflow-y-auto">
        <SidebarNav />
      </div>

      <div className="flex flex-col gap-2.5 border-t border-border-section p-4">
        <SidebarStat />
        <AccountMenu name={user.name} email={user.email} />
      </div>
    </div>
  );
}
