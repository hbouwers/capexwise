"use client";

import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";

/**
 * A read that failed, inside the shell, with a retry. **The page fails, not a
 * region** (`docs/ui/screens/README.md`, errors): these screens cross-reference
 * their own figures, and a page that silently dropped one region would show
 * totals that no longer add up.
 *
 * Nothing about the error is shown or logged here. Its message can carry a
 * query's parameters, and the server has already logged it with the digest
 * that ties the two together.
 */
export default function AppError({ retry }: { retry: () => void }) {
  return (
    <>
      <PageHeader
        title="Something went wrong"
        subtitle="This page did not load"
      />
      <PageBody>
        <div className="flex max-w-prose flex-col items-start gap-3">
          <p className="text-sm leading-normal text-text-tertiary">
            Nothing was changed. Try again, and if it keeps happening, reload
            the page.
          </p>
          <Button variant="outline" onClick={() => retry()}>
            Try again
          </Button>
        </div>
      </PageBody>
    </>
  );
}
