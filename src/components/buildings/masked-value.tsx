"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { REVEAL_SECONDS } from "@/lib/building-facts";
import { revealAccessCode } from "@/server/actions/building-facts";

/**
 * One access code, masked until asked for (`docs/ui/components.md` §9,
 * findings 5–7).
 *
 * - **The page holds no code.** This renders from an id; the plaintext exists
 *   in the browser only between a `Reveal` and the moment it re-masks.
 * - **The mask is eight dots whatever the code**, so it does not say how many
 *   digits there are — the cipher pads every code to one length for the same
 *   reason.
 * - **One code per reveal.** `Reveal` asks the server for this row alone, and
 *   the server records that it did (ADR-0008).
 * - **It re-masks after `REVEAL_SECONDS`**, when `Hide` is pressed, and when
 *   the page is left — including into the back-forward cache, where a page is
 *   kept alive and would come back showing the code.
 *
 * `Reveal` is 44px tall below `md`: a door code is read on a doorstep,
 * one-handed (`building-detail.md`, narrow viewports).
 */
const MASK = "••••••••";

export function MaskedValue({
  accessCodeId,
  name,
}: {
  accessCodeId: string;
  /** The code's name on the card, for the button's accessible name. */
  name: string;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function hide() {
    clearTimeout(timer.current);
    setCode(null);
  }

  useEffect(() => {
    window.addEventListener("pagehide", hide);

    return () => {
      window.removeEventListener("pagehide", hide);
      clearTimeout(timer.current);
    };
  }, []);

  function reveal() {
    setFailed(false);

    startTransition(async () => {
      const result = await revealAccessCode(accessCodeId).catch(() => ({
        ok: false as const,
      }));

      if (!result.ok) {
        setFailed(true);
        return;
      }

      setCode(result.code);
      clearTimeout(timer.current);
      timer.current = setTimeout(hide, REVEAL_SECONDS * 1000);
    });
  }

  const revealed = code !== null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2.5">
        {/* Announced when it changes, so a screen reader hears the code it
            asked for without having to go looking. */}
        <span
          aria-live="polite"
          className="min-w-0 font-mono text-sm leading-tight break-all text-text-primary tabular-nums"
        >
          {revealed ? (
            code
          ) : (
            <>
              <span aria-hidden className="tracking-wider">
                {MASK}
              </span>
              <span className="sr-only">Hidden</span>
            </>
          )}
        </span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={pending}
          onClick={revealed ? hide : reveal}
          aria-label={`${revealed ? "Hide" : "Reveal"} ${name}`}
          className="max-md:h-11 max-md:px-4 max-md:text-sm"
        >
          {pending ? "Revealing…" : revealed ? "Hide" : "Reveal"}
        </Button>
      </div>
      {failed ? (
        <p role="alert" className="text-2xs leading-snug text-status-danger">
          Couldn’t reveal this code. Try again.
        </p>
      ) : null}
    </div>
  );
}
