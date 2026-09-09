import { Button } from "@/components/ui/button";
import { signOut } from "@/server/actions/auth";
import { requireSession } from "@/server/session";

/**
 * Still the placeholder it was, and now a protected one — the first route to use
 * the pattern in `src/server/session.ts`, which is what makes that pattern a
 * thing that runs rather than a thing that is described.
 *
 * What is on the page is scaffolding. #12 specifies the screens and #29 builds
 * the shell around them; the dashboard that belongs here (F0) is neither. What
 * is worth keeping until then is the two lines that prove the whole flow
 * arrived: `requireSession()` at the top, and a sign-out that works.
 *
 * The org is deliberately not shown. It is on the session as
 * `activeOrganizationId`, and reading it straight off the session would model
 * exactly the mistake ADR-0004 warns about — the session names the org the
 * browser is *asking* for, and only the `memberships` join says whether they may
 * have it. #26's `getOrgContext()` is what does that join, and the org's name
 * belongs on this page the moment it exists.
 */
export default async function Home() {
  const { user } = await requireSession();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-surface-page p-8">
      <h1 className="text-2xl font-semibold text-text-primary">CapExWise</h1>

      <p className="text-sm text-text-tertiary">
        Signed in as <span className="text-text-primary">{user.email}</span>
      </p>

      <form action={signOut}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </main>
  );
}
