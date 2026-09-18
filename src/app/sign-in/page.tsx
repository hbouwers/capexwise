import type { Metadata } from "next";

import { DemoSignIn } from "@/components/demo-sign-in";
import { Button } from "@/components/ui/button";
import { GoogleMark } from "@/components/google-mark";
import { withoutParameters } from "@/lib/query-errors";
import { signInWithGoogle } from "@/server/actions/auth";
import { findDemoOrgId } from "@/server/demo";
import { env } from "@/server/env";
import { AFTER_SIGN_IN_PATH, getSession } from "@/server/session";
import { redirect } from "next/navigation";

/**
 * The way in, and the only page a signed-out browser can see.
 *
 * **The design here is provisional and knows it.** The prototype never drew a
 * sign-in screen, and the per-screen specs are #12 — so this is built from the
 * tokens and the primitives directly, kept deliberately plain, and expected to
 * be redrawn rather than extended. What it must not be is off-token: every
 * colour, size and weight below comes from `docs/ui/tokens.md`, so a redraw
 * changes the layout and not the palette.
 *
 * One sign-in method, because ADR-0004 chose one: Google OAuth, no passwords, no
 * email provider, no domain. The second button is not a second method but a way
 * to look without one: `Explore the demo` (ADR-0011), offered wherever a demo
 * org has been seeded.
 */
export const metadata: Metadata = {
  title: "Sign in — CapExWise",
  description: "Sign in to CapExWise.",
};

export default async function SignInPage({
  searchParams,
}: PageProps<"/sign-in">) {
  // A signed-in browser has no business here, and landing on it after a
  // successful sign-in is the confusing half of a redirect loop. This is the
  // mirror of `requireSession()` and the reason both live behind one constant.
  if (await getSession()) redirect(AFTER_SIGN_IN_PATH);

  // Better Auth appends `?error=<code>` when an OAuth round trip fails, and
  // `errorCallbackURL` in the sign-in action points it here. Presence is the
  // signal, not the value: the codes are the library's and grow with it, and the
  // provider's own `error_description` is not written for this reader and is not
  // ours to render verbatim. One banner covers all of them.
  const failed = (await searchParams).error !== undefined;

  // A preview cannot finish a Google round trip: Google matches redirect URIs
  // exactly, and every preview branch has a hostname nobody registered (#32).
  // The button would lead to Google's `redirect_uri_mismatch` page, so it is
  // replaced by a line saying where signed-in pages can be seen instead.
  const preview = env().VERCEL_ENV === "preview";

  // Needs no OAuth round trip, so unlike Google it works on a preview too —
  // wherever that preview's database holds a demo.
  //
  // **This page renders without a database, and has to keep doing so.** It is
  // what the Dockerfile's HEALTHCHECK and CI's container job fetch, because it
  // was the one route that reached neither the database nor Google, and both
  // run with no database behind them. So a demo check that cannot reach it
  // hides the button rather than taking the page down — with nothing to sign
  // in to, there is no demo to offer either.
  const demo = await findDemoOrgId().then(
    (id) => id !== null,
    (error: unknown) => {
      console.error(
        withoutParameters(error, "Looking for the demo org").message,
      );
      return false;
    },
  );

  return (
    <main className="flex flex-1 items-center justify-center bg-surface-page p-8">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">
          CapExWise
        </h1>
        <p className="mt-1 text-xs leading-normal text-text-tertiary">
          Capital planning for small residential landlords.
        </p>

        <div className="mt-6 rounded-lg border border-border-card bg-surface-card p-6">
          {failed ? (
            // `role="alert"` rather than a styled div: the person who most needs
            // to know the attempt failed is the one who cannot see the tint.
            <p
              role="alert"
              className="mb-4 rounded-md bg-tint-danger px-3 py-2 text-xs leading-normal text-status-danger"
            >
              That sign-in did not complete. Nothing was changed — try again.
            </p>
          ) : null}

          {preview ? (
            <p className="rounded-md bg-tint-neutral px-3 py-2 text-xs leading-normal text-status-neutral">
              Sign-in is off on preview deployments. To see the signed-in pages,
              run this branch locally.
            </p>
          ) : (
            <>
              {/* A form and a submit button, not an onClick. It is a real POST,
                  so it works before hydration and without JavaScript, and the
                  action runs on the server where the OAuth state cookie has to
                  be set. */}
              <form action={signInWithGoogle}>
                <Button type="submit" variant="outline" className="w-full">
                  <GoogleMark />
                  Continue with Google
                </Button>
              </form>

              <p className="mt-4 text-xs leading-normal text-text-muted">
                Signing in creates an account if you do not have one.
              </p>
            </>
          )}

          {demo ? (
            <div className="mt-6 border-t border-border-card pt-6">
              <DemoSignIn destination={AFTER_SIGN_IN_PATH} />
              <p className="mt-4 text-xs leading-normal text-text-muted">
                A sample portfolio in Indianapolis, with no account. Anyone
                exploring it can change it, and it resets every night.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
