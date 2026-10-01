import { PageBody } from "@/components/shell/page-header";
import { TaxDisclaimer } from "@/components/tax/tax-disclaimer";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The tax planner while it loads (`docs/ui/screens/tax-planner.md`, States):
 * **the disclaimer immediately, never a skeleton**, then the statement's seven
 * rows, the liability card and three decision rows, at the heights they
 * render at.
 */
export default function TaxLoading() {
  return (
    <>
      <div className="border-b border-border-card px-5 py-4 lg:h-(--header-height) lg:px-8.5 lg:py-0">
        <div className="flex h-full flex-col justify-center gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-48 max-w-full" />
        </div>
      </div>
      <PageBody>
        <div className="flex flex-col gap-5">
          <TaxDisclaimer />
          <div
            className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_336px]"
            aria-busy="true"
          >
            <Skeleton className="h-64 rounded-lg lg:col-start-2 lg:row-start-1" />
            <div className="flex flex-col gap-5 lg:col-start-1 lg:row-start-1">
              <div className="flex flex-col gap-4 rounded-lg border border-border-card p-5">
                <Skeleton className="h-4 w-56" />
                {[0, 1, 2, 3, 4, 5, 6].map((row) => (
                  <Skeleton key={row} className="h-6" />
                ))}
              </div>
              <div className="flex flex-col gap-4 rounded-lg border border-border-card p-5">
                <Skeleton className="h-4 w-44" />
                {[0, 1, 2].map((row) => (
                  <Skeleton key={row} className="h-10" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </PageBody>
    </>
  );
}
