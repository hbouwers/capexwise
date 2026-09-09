import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { GoogleMark } from "@/components/google-mark";
import { signInWithGoogle } from "@/server/actions/auth";
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
 * email provider, no domain. There is nothing to lay out but a button.
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

  // Set by `errorCallbackURL` in the sign-in action: Google's own failures — a
  // declined consent screen, a cancelled flow. Deliberately one flag rather than
  // the provider's message, which is not written for this reader and is not ours
  // to render verbatim.
  const failed = (await searchParams).error === "oauth";

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

          {/* A form and a submit button, not an onClick. It is a real POST, so
              it works before hydration and without JavaScript, and the action
              runs on the server where the OAuth state cookie has to be set. */}
          <form action={signInWithGoogle}>
            <Button type="submit" variant="outline" className="w-full">
              <GoogleMark />
              Continue with Google
            </Button>
          </form>

          <p className="mt-4 text-xs leading-normal text-text-muted">
            Signing in creates an account if you do not have one.
          </p>
        </div>
      </div>
    </main>
  );
}
