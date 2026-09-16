import { PageBody } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * A building's page while it loads: the header, the summary's badge and tile,
 * a three-row units table, the facts card's four groups and eight rows of
 * equipment, at the heights they render at
 * (`docs/ui/screens/building-detail.md`, states). Each region that joins the
 * page adds its own rows here.
 */
export default function BuildingLoading() {
  return (
    <>
      <div className="border-b border-border-card px-5 py-4 lg:h-(--header-height) lg:px-8.5 lg:py-0">
        <div className="flex h-full flex-col justify-center gap-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
      </div>
      <PageBody>
        <div className="flex flex-col gap-6" aria-busy="true">
          <Skeleton className="h-3 w-24" />
          <div className="flex flex-col gap-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-16 rounded-lg sm:h-28 sm:w-56" />
          </div>
          <div className="flex flex-col gap-px overflow-hidden rounded-lg border border-border-card">
            <Skeleton className="h-13 rounded-none" />
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-12 rounded-none opacity-60" />
            ))}
          </div>
          <div className="@container overflow-hidden rounded-lg border border-border-card">
            <Skeleton className="h-13 rounded-none" />
            <div className="grid gap-x-8 gap-y-7 px-5 py-5 @lg:grid-cols-2 @4xl:grid-cols-4">
              {[0, 1, 2, 3].map((group) => (
                <div key={group} className="flex flex-col gap-3">
                  <Skeleton className="h-2.5 w-20" />
                  <Skeleton className="h-9 w-full opacity-60" />
                  <Skeleton className="h-9 w-3/4 opacity-60" />
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-px overflow-hidden rounded-lg border border-border-card">
            <Skeleton className="h-16 rounded-none" />
            <Skeleton className="h-13 rounded-none opacity-80" />
            {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
              <Skeleton key={row} className="h-14 rounded-none opacity-60" />
            ))}
          </div>
        </div>
      </PageBody>
    </>
  );
}
