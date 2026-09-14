import type { Metadata } from "next";

import { BuildingForm } from "@/components/buildings/building-form";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { emptyBuildingFields } from "@/lib/building-form";
import { getOrgContext } from "@/server/org-context";

/**
 * `docs/ui/screens/building-form.md`, for a building that does not exist yet.
 * #39 owns making entry fast; this is the plain form that makes it possible.
 *
 * The free plan's one-unit allowance is billing's to enforce (v1), so the form
 * takes any number of units until billing says otherwise.
 */
export const metadata: Metadata = { title: "Add a building — CapExWise" };

export default async function NewBuildingPage() {
  // The protection, not a lookup — this page reads nothing, and relying on the
  // layout's call instead is the mistake `(app)/layout.tsx` describes.
  await getOrgContext();

  return (
    <>
      <PageHeader
        title="Add a building"
        subtitle="Address, units, and what you paid"
      />
      <PageBody>
        <BuildingForm mode={{ kind: "new" }} initial={emptyBuildingFields()} />
      </PageBody>
    </>
  );
}
