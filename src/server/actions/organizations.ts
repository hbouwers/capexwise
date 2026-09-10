"use server";

/**
 * The org switcher's one write (#29): which org this session opens in.
 *
 * **What it changes is the hint, not the context.** The session's
 * `activeOrganizationId` is an ordering preference that `getOrgContext()`
 * re-checks against `memberships` on every request, so nothing written here can
 * put a request inside an org its user is not a live member of. The action is
 * careful anyway, because the switcher is the one place in the product where the
 * browser names an org on purpose — and ADR-0003's rule for a client-supplied
 * org id is that it is ignored, not validated:
 *
 * - The value from the browser is only ever a **lookup key** into the list of
 *   orgs the caller already belongs to, resolved here on the server. What is
 *   written is the id from that list, never the value that arrived.
 * - A value that matches nothing in the list — another tenant's org, a
 *   soft-deleted one, something that is not an id — is dropped without a word.
 *   There is no error branch for it, so there is no error branch to get wrong,
 *   and a stranger probing ids learns nothing from the response.
 *
 * It writes through Better Auth's own `set-active` endpoint rather than updating
 * `sessions` directly, and that is not deference to the library. The session is
 * cached in a signed cookie for five minutes (`session.cookieCache` in
 * `src/server/auth.ts`), and the endpoint rewrites that cookie along with the
 * row. A direct update would change the row and leave the cookie, and the
 * switcher would appear to do nothing for up to five minutes.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/server/auth";
import { getOrgContext, listOrgsForUser } from "@/server/org-context";
import { AFTER_SIGN_IN_PATH } from "@/server/session";

/**
 * `unknown`, not `string`: an action's arguments arrive from the browser, and
 * the type a caller in this repository passes is no evidence of what a request
 * carries.
 */
export async function switchOrganization(requested: unknown): Promise<void> {
  const { user, org } = await getOrgContext();

  const target = (await listOrgsForUser(user.id)).find(
    (option) => option.id === requested,
  );

  // Choosing the org already open is a closed menu, not a navigation.
  if (!target || target.id === org.id) return;

  await getAuth().api.setActiveOrganization({
    body: { organizationId: target.id },
    headers: await headers(),
  });

  // To the dashboard, not back to the page the switch was made from. That page
  // belongs to the org being left — a building's detail page, say — and in the
  // new org it is at best somebody else's URL and at worst a 404. `redirect()`
  // also starts a new request, which is what `getOrgContext()`'s per-request
  // cache needs to see the org that was just chosen.
  redirect(AFTER_SIGN_IN_PATH);
}
