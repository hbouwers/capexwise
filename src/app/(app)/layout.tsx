import { AppShell } from "@/components/shell/app-shell";
import { getOrgContext, listOrgsForUser } from "@/server/org-context";

/**
 * Every signed-in screen, inside the shell. `(app)` is a route group: it adds a
 * layout without adding a URL segment, so `/maintenance` is still
 * `/maintenance`, and `/sign-in` and `/styleguide` — outside the group — render
 * without the shell.
 *
 * **This is not the protection.** `getOrgContext()` redirects a stranger, but a
 * layout is not re-run on every navigation between the pages under it, so a
 * page that relied on its layout's check would be reachable by a request the
 * layout never saw. Each page makes its own call; `getOrgContext()` is cached
 * per request, so the second call costs nothing. `src/server/session.ts` has
 * the rule.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, org } = await getOrgContext();
  const orgs = await listOrgsForUser(user.id);

  return (
    <AppShell
      org={{ id: org.id, name: org.name }}
      orgs={orgs}
      user={{ name: user.name, email: user.email }}
    >
      {children}
    </AppShell>
  );
}
