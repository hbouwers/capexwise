import { PageBody } from "@/components/shell/page-header";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The edit form while its building loads. Its own file so the building page's
 * skeleton — a summary and a table — is not what stands in for a form.
 */
export default function EditBuildingLoading() {
  return (
    <>
      <div className="border-b border-border-card px-5 py-4 lg:h-(--header-height) lg:px-8.5 lg:py-0">
        <div className="flex h-full flex-col justify-center gap-2">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-3 w-48" />
        </div>
      </div>
      <PageBody>
        <div className="flex max-w-160 flex-col gap-5" aria-busy="true">
          <Skeleton className="h-80 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
      </PageBody>
    </>
  );
}
