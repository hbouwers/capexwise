import { PageBody } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The portfolio while it loads (`docs/ui/screens/portfolio.md`, states): the
 * header's height, four tiles, two building cards and the rail's two cards,
 * each at the height it renders at, so nothing jumps when the data lands.
 */
export default function PortfolioLoading() {
  return (
    <>
      <div className="border-b border-border-card px-5 py-4 lg:h-(--header-height) lg:px-8.5 lg:py-0">
        <div className="flex h-full flex-col justify-center gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <PageBody>
        <div className="flex flex-col gap-6" aria-busy="true">
          <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(168px,1fr))] sm:gap-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-14 rounded-lg sm:h-28" />
            ))}
          </div>
          <div className="grid-two-column items-start">
            <div className="@container flex flex-col gap-4">
              <Skeleton className="h-4 w-32" />
              <div className="grid gap-4 @xl:grid-cols-2">
                <Skeleton className="h-56 rounded-lg" />
                <Skeleton className="h-56 rounded-lg" />
              </div>
            </div>
            <div className="flex flex-col gap-5">
              <Skeleton className="h-64 rounded-lg" />
              <Skeleton className="h-48 rounded-lg" />
            </div>
          </div>
        </div>
      </PageBody>
    </>
  );
}
