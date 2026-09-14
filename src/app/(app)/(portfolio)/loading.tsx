import { PageBody } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The portfolio while its buildings load: the header's height, and two cards
 * at the height a card renders at, so nothing jumps when the data lands
 * (`docs/ui/screens/portfolio.md`, states). The tiles and the rail join this
 * when they join the page (#115).
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
        <div className="@container flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-4 w-32" />
          <div className="grid gap-4 @xl:grid-cols-2">
            <Skeleton className="h-36 rounded-lg" />
            <Skeleton className="h-36 rounded-lg" />
          </div>
        </div>
      </PageBody>
    </>
  );
}
