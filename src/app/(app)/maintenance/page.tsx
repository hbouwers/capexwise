import type { Metadata } from "next";

import { PageBody, PageHeader } from "@/components/shell/page-header";
import { getOrgContext } from "@/server/org-context";

/**
 * A placeholder until F5 — the Unscheduled and Scheduled tabs, recurring tasks
 * and the seasonal rhythm. #12 specifies it as `maintenance.md`.
 */
export const metadata: Metadata = { title: "Maintenance — CapExWise" };

export default async function MaintenancePage() {
  // The protection, not a lookup: this page reads nothing yet, and relying on
  // the layout's call instead is the mistake `(app)/layout.tsx` describes.
  await getOrgContext();

  return (
    <>
      <PageHeader
        title="Maintenance"
        subtitle="Scheduled and unscheduled work across the portfolio"
      />
      <PageBody>
        <p className="max-w-prose text-sm leading-normal text-text-tertiary">
          Not built yet. Recurring and one-off work, scheduled or waiting on a
          date, will be here.
        </p>
      </PageBody>
    </>
  );
}
