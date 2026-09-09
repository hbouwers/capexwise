"use server";

/**
 * Signing in and signing out, as Server Actions.
 *
 * **These are the exception to the rule that every action in this directory
 * starts with `getOrgContext()`** (CLAUDE.md). They run before there is a
 * session to resolve an org from — that is what they are for — and they are the
 * only two files that will ever have that excuse. Anything else added here would
 * be a mutation of domain data outside the tenancy boundary.
 *
 * Server Actions rather than Better Auth's React client, and that is a choice
 * worth stating. The client is a browser bundle plus a `"use client"` boundary,
 * and it buys reactivity that a sign-in button does not need: this is a form
 * post that ends in a redirect. Keeping it on the server holds to the "Server
 * Components by default" convention and keeps the auth library out of the client
 * bundle entirely. The org switcher (#29) is the first thing that might
 * genuinely want the client; it can add it then.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "@/server/auth";
import { AFTER_SIGN_IN_PATH, SIGN_IN_PATH } from "@/server/session";

export async function signInWithGoogle(): Promise<void> {
  const { url } = await getAuth().api.signInSocial({
    body: {
      provider: "google",
      callbackURL: AFTER_SIGN_IN_PATH,
      // Where Google's own failures land — a declined consent screen, a
      // cancelled flow. Without it Better Auth redirects to its own error page,
      // which is a bare JSON-ish screen at a URL under `/api`. Back to the
      // sign-in page with a flag it can render is the same information somewhere
      // the person can act on.
      errorCallbackURL: `${SIGN_IN_PATH}?error=oauth`,
    },
    // The endpoint sets the OAuth state cookie, and this is what carries it back
    // out: the `nextCookies()` plugin writes it through Next's own cookie API,
    // which only works from an action or a route handler.
    headers: await headers(),
  });

  if (!url) {
    // Not reachable for a social provider — the endpoint either returns an
    // authorization URL or throws — but the type is optional because the same
    // response shape covers the ID-token path, and an unexplained `undefined`
    // redirect is worse than a message.
    throw new Error("Google did not return an authorization URL.");
  }

  redirect(url);
}

export async function signOut(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });

  redirect(SIGN_IN_PATH);
}
