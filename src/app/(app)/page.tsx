import { PageBody, PageHeader } from "@/components/shell/page-header";
import { getOrgContext } from "@/server/org-context";

/**
 * The portfolio dashboard's route, and a placeholder until F0 and F1 fill it:
 * the five stat tiles, then the building cards. #12 specifies it as
 * `portfolio.md`.
 *
 * It calls `getOrgContext()` itself rather than trusting the layout's call — the
 * layout comment says why — and uses the org it gets back for the subtitle, the
 * first place a screen names the org it is showing.
 */
export default async function PortfolioPage() {
  const { org } = await getOrgContext();

  return (
    <>
      <PageHeader title="Portfolio" subtitle={org.name} />
      <PageBody>
        <p className="max-w-prose text-sm leading-normal text-text-tertiary">
          Not built yet. Your buildings, and what is coming due across them,
          will be here.
        </p>
      </PageBody>
    </>
  );
}
