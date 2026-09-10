import type { Metadata } from "next";

import { PageBody, PageHeader } from "@/components/shell/page-header";
import { getOrgContext } from "@/server/org-context";

/**
 * A placeholder until F6 — contacts with trade tags, filterable. #12 specifies
 * it as `contacts.md`.
 */
export const metadata: Metadata = { title: "Contact book — CapExWise" };

export default async function ContactsPage() {
  // The protection, not a lookup: this page reads nothing yet, and relying on
  // the layout's call instead is the mistake `(app)/layout.tsx` describes.
  await getOrgContext();

  return (
    <>
      <PageHeader
        title="Contact book"
        subtitle="Vendors and professionals, tagged by trade"
      />
      <PageBody>
        <p className="max-w-prose text-sm leading-normal text-text-tertiary">
          Not built yet. The vendors and professionals you call, tagged by
          trade, will be here.
        </p>
      </PageBody>
    </>
  );
}
