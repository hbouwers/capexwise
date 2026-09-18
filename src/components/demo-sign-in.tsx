"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

/**
 * `Explore the demo` on the sign-in page (#34, ADR-0011): an anonymous session
 * in the demo org, with no account to make.
 *
 * **A client component, where Google's button is a Server Action, and the
 * reason is the rate limit.** Better Auth counts requests in its HTTP handler,
 * so a Server Action calling `auth.api` directly would never be counted — and
 * each visit writes a user, a session and a membership. Posting to the
 * endpoint itself is what puts `/sign-in/anonymous` under the limit in
 * `src/server/auth.ts`, and under the handler's origin check. No auth client
 * library: it is one `fetch`.
 *
 * A full navigation afterwards rather than `router.push`, so the first request
 * that renders a page is one that carries the new cookie. `destination` is
 * `AFTER_SIGN_IN_PATH`, handed down because `@/server/session` is server-only.
 */
export function DemoSignIn({ destination }: { destination: string }) {
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<"busy" | "failed" | null>(null);

  function explore() {
    setFailure(null);

    startTransition(async () => {
      const response = await fetch("/api/auth/sign-in/anonymous", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }).catch(() => null);

      if (response?.ok) {
        window.location.assign(destination);
        return;
      }

      setFailure(response?.status === 429 ? "busy" : "failed");
    });
  }

  return (
    <>
      {failure ? (
        <p
          role="alert"
          className="mb-4 rounded-md bg-tint-danger px-3 py-2 text-xs leading-normal text-status-danger"
        >
          {failure === "busy"
            ? "Too many demo visits from this address. Wait a minute and try again."
            : "The demo did not open. Try again."}
        </p>
      ) : null}

      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={pending}
        onClick={explore}
      >
        Explore the demo
      </Button>
    </>
  );
}
