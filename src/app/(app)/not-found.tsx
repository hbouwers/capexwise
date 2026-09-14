import Link from "next/link";

import { PageBody, PageHeader } from "@/components/shell/page-header";

/**
 * What `notFound()` renders inside the shell. One page for a record that does
 * not exist and one that belongs to another org, with one sentence for both —
 * so a URL cannot be used to learn whether an id exists anywhere
 * (`docs/ui/screens/README.md`, errors).
 */
export default function NotFound() {
  return (
    <>
      <PageHeader title="Not found" subtitle="Nothing here" />
      <PageBody>
        <div className="flex max-w-prose flex-col items-start gap-3">
          <p className="text-sm leading-normal text-text-tertiary">
            This page does not exist, or it is not in the organization you are
            signed in to.
          </p>
          <Link
            href="/"
            className="text-sm text-accent underline-offset-4 hover:underline"
          >
            Back to the portfolio
          </Link>
        </div>
      </PageBody>
    </>
  );
}
