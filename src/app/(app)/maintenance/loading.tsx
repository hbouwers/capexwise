import { PageBody } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Maintenance while it loads (`docs/ui/screens/maintenance.md`, states): four
 * tile skeletons, the tab list and eight rows, at the heights they render at,
 * so nothing jumps when the tasks land.
 */
export default function MaintenanceLoading() {
  return (
    <>
      <div className="border-b border-border-card px-5 py-4 lg:h-(--header-height) lg:px-8.5 lg:py-0">
        <div className="flex h-full flex-col justify-center gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
      </div>
      <PageBody>
        <div className="flex flex-col gap-6" aria-busy="true">
          <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(168px,1fr))] sm:gap-4">
            {[0, 1, 2, 3].map((tile) => (
              <Skeleton key={tile} className="h-14 rounded-lg sm:h-28" />
            ))}
          </div>
          <Skeleton className="h-8 w-full rounded-lg sm:w-80" />
          <div className="flex flex-col gap-3 rounded-lg border border-border-card p-5">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
              <Skeleton key={row} className="h-9" />
            ))}
          </div>
        </div>
      </PageBody>
    </>
  );
}
