"use client";

import { MenuIcon } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * The rail, below `lg`: a menu button that opens the same `Sidebar` as a drawer
 * from the left. `docs/ui/components.md` §4 records why it is this and not
 * something else.
 *
 * A `Sheet` rather than a hand-rolled panel, because the drawer is modal and the
 * primitive already is: it traps focus, closes on Escape and on the scrim, puts
 * focus back on the button when it closes, and hides the page behind it from a
 * screen reader while it is open.
 */
export function MobileNav({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  // Following a link closes the drawer. Next's navigation keeps this component
  // mounted — the layout does not re-render — so without this the drawer would
  // sit open over the page it just navigated to. Listening for the click rather
  // than for the pathname to change also covers the link to the page already
  // open, where the pathname never changes at all.
  function closeOnLink(event: MouseEvent) {
    if ((event.target as Element).closest("a")) setOpen(false);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="-ml-1.5">
          <MenuIcon aria-hidden />
          <span className="sr-only">Open navigation</span>
        </Button>
      </SheetTrigger>

      <SheetContent
        side="left"
        // No description: the title and the nav's own labels say everything a
        // description would, and Radix asks for one to be opted out of rather
        // than silently omitted.
        aria-describedby={undefined}
        // The rail's own width, so the drawer is the rail rather than a
        // stretched copy of it. Written with the variant because the
        // primitive's `w-3/4` carries one, and a plain `w-*` loses to it.
        className="gap-0 p-0 data-[side=left]:w-(--sidebar-width)"
        onClick={closeOnLink}
        // Radix opens a dialog by focusing its first tabbable element that is
        // not a link — here, the account menu at the very bottom. The link to
        // the page already open is where somebody who opened the nav is
        // standing, so focus starts there and Tab moves on from it.
        onOpenAutoFocus={(event) => {
          const current = (event.currentTarget as Element).querySelector(
            '[aria-current="page"]',
          );

          if (current instanceof HTMLElement) {
            event.preventDefault();
            current.focus();
          }
        }}
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
