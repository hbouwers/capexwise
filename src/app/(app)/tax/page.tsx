import type { Metadata } from "next";

import { PageBody, PageHeader } from "@/components/shell/page-header";
import { getOrgContext } from "@/server/org-context";

/**
 * A placeholder until F4, which is v1 rather than v0. #12 specifies it as
 * `tax-planner.md`, including the disclaimer. There is no figure on this page
 * yet, so there is nothing for the disclaimer to qualify; it arrives with the
 * first one, and it is not dismissible when it does.
 */
export const metadata: Metadata = { title: "Tax planner — CapExWise" };

export default async function TaxPage() {
  // The protection, not a lookup: this page reads nothing yet, and relying on
  // the layout's call instead is the mistake `(app)/layout.tsx` describes.
  await getOrgContext();

  return (
    <>
      <PageHeader title="Tax planner" subtitle="Schedule E estimate" />
      <PageBody>
        <p className="max-w-prose text-sm leading-normal text-text-tertiary">
          Not built yet. The estimated Schedule E for the year, and what timing
          a project differently would change, will be here.
        </p>
      </PageBody>
    </>
  );
}
