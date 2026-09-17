"use client";

import { XIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The shell every modal in the product sits in (`docs/ui/components.md` §7):
 * a header, a body that scrolls, and a footer that stays put — so a modal's
 * primary action is reachable without scrolling at every width
 * (`docs/ui/screens/README.md`, modals below `md`).
 *
 * From `md` up it is a card of the modal's own width, at most 88% of the
 * viewport's height, over the scrim. Below `md` it fills the viewport: no
 * radius, no border, and the scrim hidden behind it.
 *
 * Open state is the caller's. The contact modal and the task modal live in the
 * URL, so opening one is a navigation and closing one is another, and only
 * the caller knows which URL to go back to — or that the form is dirty and
 * closing should ask first.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  meta,
  width,
  footer,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Under the title and the description: a row of chips, as the task modal has. */
  meta?: ReactNode;
  /** From `md` up. The spec gives each modal's: 560px, 900px, 920px. */
  width: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        // Radix warns about a dialog with no description unless it is told
        // there is none on purpose.
        {...(description ? {} : { "aria-describedby": undefined })}
        style={{ "--modal-width": width } as CSSProperties}
        // `sm:max-w-none` undoes the primitive's `sm:max-w-sm`, which would
        // otherwise hold the modal to 24rem between `sm` and `md`. No focus
        // ring on the dialog itself: Radix focuses it only when nothing inside
        // is focusable yet, and nobody can tab to it, so a ring round the
        // whole modal would mark nothing a person could act on.
        className="flex flex-col gap-0 overflow-hidden p-0 focus-visible:outline-none max-md:inset-0 max-md:h-dvh max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:border-0 sm:max-w-none md:max-h-[88vh] md:max-w-(--modal-width)"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border-card px-5 py-4 md:px-6.5">
          <div className="flex min-w-0 flex-col gap-1">
            <DialogTitle className="text-md leading-tight font-semibold text-text-primary">
              {title}
            </DialogTitle>
            {description ? (
              <DialogDescription className="text-xs leading-snug text-text-muted">
                {description}
              </DialogDescription>
            ) : null}
            {meta}
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-2">
              <XIcon aria-hidden />
              <span className="sr-only">Close</span>
            </Button>
          </DialogClose>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6.5">
          {children}
        </div>

        <div className="border-t border-border-card bg-surface-subtle px-5 py-3.5 md:px-6.5">
          {footer}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A modal's footer, asking before it does something that cannot be taken back
 * from inside the modal: throwing away what was typed, or archiving. In the footer
 * rather than a second dialog, so the question sits where the button that
 * raised it was.
 */
export function FooterQuestion({
  question,
  detail,
  keep,
  confirm,
  destructive,
  disabled,
  onKeep,
  onConfirm,
}: {
  question: string;
  detail?: string;
  keep: string;
  confirm: string;
  destructive?: boolean;
  disabled?: boolean;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  return (
    // A labelled group rather than an `alertdialog`, which would claim to be a
    // second modal. Focus moves to its first button as it appears, so the
    // question is read out with the choice.
    <div
      role="group"
      aria-labelledby="footer-question"
      aria-describedby={detail ? "footer-question-detail" : undefined}
      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-1">
        <p
          id="footer-question"
          className="text-sm leading-tight font-medium text-text-primary"
        >
          {question}
        </p>
        {detail ? (
          <p
            id="footer-question-detail"
            className="text-xs leading-snug text-text-muted"
          >
            {detail}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
        <Button type="button" variant="outline" onClick={onKeep} autoFocus>
          {keep}
        </Button>
        <Button
          type="button"
          variant={destructive ? "destructive" : "default"}
          disabled={disabled}
          onClick={onConfirm}
        >
          {confirm}
        </Button>
      </div>
    </div>
  );
}
