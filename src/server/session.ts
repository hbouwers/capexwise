/**
 * The protected-route pattern, written once. #25's last checklist item is that
 * it be documented once and used everywhere, so this is the file to point at.
 *
 * There are exactly two ways to ask about the signed-in user, and the difference
 * between them is what happens when there is none:
 *
 * ```ts
 * // A page or component that must not render to a stranger. Redirects.
 * const { user } = await requireSession();
 *
 * // A page that renders either way — a marketing page, the sign-in screen.
 * const session = await getSession();
 * ```
 *
 * **Neither of these is authorisation, and neither gives you a database
 * handle.** They answer "who is this", and the answer is a person, not a tenant.
 * The org that person is acting in is #26's `getOrgContext()`, which re-checks
 * the session's `activeOrganizationId` against `memberships` and hands back a
 * handle already scoped to it. Anything that reads or writes domain data starts
 * there, not here.
 *
 * **This is not middleware, deliberately.** A Next.js middleware check reads the
 * cookie without validating the session against the database, so it is a
 * redirect for tidiness rather than a boundary — and treating it as a boundary is
 * a documented way to ship an authorisation bypass. The check belongs in the
 * thing that renders the data. It is also a runtime the Cloud Run escape hatch
 * (ADR-0002) would have to re-solve.
 */
import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/server/auth";

/**
 * Where an unauthenticated request lands. One constant rather than a literal in
 * three files, because moving the sign-in page and missing one of them is a
 * redirect loop.
 */
export const SIGN_IN_PATH = "/sign-in";

/**
 * Where a signed-in request lands: the application, wherever that turns out to
 * be. The app shell (#29) is what makes this more than the placeholder root.
 */
export const AFTER_SIGN_IN_PATH = "/";

/**
 * The session, or `null`. Cheap on the common path: `session.cookieCache` in
 * `src/server/auth.ts` means most calls read a signed cookie rather than the
 * `sessions` table.
 */
export async function getSession() {
  // `headers()` first, and the order is load-bearing rather than stylistic.
  //
  // It is a dynamic API: reading it is what tells Next.js the route cannot be
  // prerendered, and it says so by throwing a bail-out that `next build`
  // catches. `getAuth()` reads the environment, and the environment is
  // deliberately absent during a build (`src/server/env.ts`) — so building the
  // provider first turns "this page is dynamic" into "the build has no
  // BETTER_AUTH_SECRET", at the first page that calls this.
  //
  // Doing it here rather than with a `dynamic = "force-dynamic"` on each page is
  // the point: a page cannot forget it. It was found by the container build,
  // which is the only build in CI that runs with a genuinely empty environment.
  const requestHeaders = await headers();

  return await getAuth().api.getSession({ headers: requestHeaders });
}

/**
 * The session, or a redirect to sign in. Never returns `null`, which is the
 * point — a caller cannot forget the branch, because there is no branch.
 *
 * `redirect()` works by throwing, so nothing after this line runs for a stranger.
 * That is what makes it safe to use at the top of a Server Component and then
 * query freely below it.
 */
export async function requireSession() {
  const session = await getSession();

  if (!session) redirect(SIGN_IN_PATH);

  return session;
}
