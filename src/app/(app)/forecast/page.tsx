import type { Metadata } from "next";

import { PageBody, PageHeader } from "@/components/shell/page-header";
import { getOrgContext } from "@/server/org-context";

/**
 * A placeholder until F3 — the ten-year chart, the per-year line items and the
 * reserve projection. #12 specifies it as `capex-forecast.md`. The rail's
 * reserve-health block links here, because this is the screen that will own
 * its number.
 */
export const metadata: Metadata = { title: "CapEx forecast — CapExWise" };

export default async function ForecastPage() {
  // The protection, not a lookup: this page reads nothing yet, and relying on
  // the layout's call instead is the mistake `(app)/layout.tsx` describes.
  await getOrgContext();

  return (
    <>
      <PageHeader
        title="CapEx forecast"
        subtitle="Ten-year capital plan, aged from equipment records"
      />
      <PageBody>
        <p className="max-w-prose text-sm leading-normal text-text-tertiary">
          Not built yet. What is due to be replaced in each of the next ten
          years, and whether the reserve covers it, will be here.
        </p>
      </PageBody>
    </>
  );
}
