import "server-only";

import type { ReactNode } from "react";

import { can, type Feature, type Plan } from "@/lib/plan";

/**
 * A premium surface, or the panel that stands in for it
 * (`docs/ui/components.md` §6).
 *
 * **Server-only, and that is the gate.** The premium content is `children`, and
 * a Server Component that does not return its children never renders them — so
 * for an org without the feature they are not in the HTML and not in the RSC
 * payload. As a Client Component the same code would receive `children` as a
 * serialized prop and hide them in the browser, which is decoration rather than
 * a gate; `server-only` makes importing this from the client a build error. It
 * is also why the locked panel is not the prototype's blurred one (§9): blur
 * implies the content arrived and is being obscured.
 *
 * `org` is a prop resolved by `getOrgContext()` on the server, never a value
 * from the browser — components.md §8.
 *
 * What it cannot do is stop a page doing the work: `children` is evaluated by
 * the page before this decides, so a page that fetches premium data to pass
 * down should ask `can()` itself before it fetches.
 *
 * There is no upgrade button. The prototype has one, and there is nothing yet
 * for it to open: Stripe is v1 (PRD §8). The panel says where the feature lives
 * instead, and billing adds the action.
 */
export function PlanGate({
  org,
  feature,
  teaser,
  children,
}: {
  org: { plan: Plan };
  feature: Feature;
  /** What is behind the gate, in the surface's own words. */
  teaser: string;
  children: ReactNode;
}) {
  if (can(org, feature)) return children;

  return (
    <div className="flex flex-col items-start gap-2.5 px-5.5 py-6.5">
      <p className="text-sm leading-normal text-text-muted">{teaser}</p>
      <p className="text-sm leading-normal font-medium text-text-secondary">
        Included with the Premium plan.
      </p>
    </div>
  );
}
