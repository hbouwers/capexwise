import { PageBody } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";

/** Bar heights for the skeleton, as a share of the chart's. */
const BARS = [70, 35, 90, 20, 55, 10, 45, 80, 30, 60];

/**
 * The forecast while it loads (`docs/ui/screens/capex-forecast.md`, states):
 * the figures, a ten-bar chart, six rows and the rail card, at the heights
 * they render at, so nothing jumps when the forecast lands.
 */
export default function ForecastLoading() {
  return (
    <>
      <div className="border-b border-border-card px-5 py-4 lg:h-(--header-height) lg:px-8.5 lg:py-0">
        <div className="flex h-full flex-col justify-center gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
      </div>
      <PageBody>
        <div className="flex flex-col gap-5" aria-busy="true">
          <div className="flex flex-col gap-5 rounded-lg border border-border-card p-5">
            <Skeleton className="h-4 w-44" />
            <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
              {[0, 1, 2].map((figure) => (
                <Skeleton key={figure} className="h-7 w-32" />
              ))}
            </div>
            <div className="grid h-36 grid-cols-10 items-end gap-1 sm:h-45 sm:gap-2">
              {BARS.map((height, index) => (
                <Skeleton
                  key={index}
                  className="rounded-b-none"
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
          </div>
          <div className="grid-two-column items-start">
            <div className="flex flex-col gap-4 rounded-lg border border-border-card p-5">
              <Skeleton className="h-4 w-56" />
              {[0, 1, 2, 3, 4, 5].map((row) => (
                <Skeleton key={row} className="h-9" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-lg" />
          </div>
        </div>
      </PageBody>
    </>
  );
}
