import { PageBody } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The contact book while it loads: the header, the chip row and six cards at
 * the height a card renders at (`docs/ui/screens/contacts.md`, states), so
 * nothing jumps when the contacts land.
 */
export default function ContactsLoading() {
  return (
    <>
      <div className="border-b border-border-card px-5 py-4 lg:h-(--header-height) lg:px-8.5 lg:py-0">
        <div className="flex h-full flex-col justify-center gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
      </div>
      <PageBody>
        <div className="flex flex-col gap-5" aria-busy="true">
          <div className="flex flex-col gap-3 rounded-lg border border-border-card py-4">
            <Skeleton className="mx-5 h-3 w-28" />
            <div className="flex gap-2 overflow-hidden px-5">
              {[14, 20, 16, 18, 22].map((width) => (
                <Skeleton
                  key={width}
                  className="h-7.5 shrink-0 rounded-full"
                  style={{ width: `${width * 0.25}rem` }}
                />
              ))}
            </div>
          </div>
          <div className="grid gap-3.5 sm:grid-cols-[repeat(auto-fill,minmax(17rem,1fr))]">
            {[0, 1, 2, 3, 4, 5].map((card) => (
              <Skeleton key={card} className="h-44 rounded-lg" />
            ))}
          </div>
        </div>
      </PageBody>
    </>
  );
}
