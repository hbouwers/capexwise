"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { archiveBuilding, restoreBuilding } from "@/server/actions/buildings";

/**
 * The foot of the edit form (`docs/ui/screens/building-form.md`, Archive):
 * archive an active building, or restore an archived one. A sold building is
 * #43's and gets neither.
 *
 * Archiving asks first, in a modal, because it takes the building out of every
 * total on the portfolio. Restoring does not: it puts figures back, and the
 * next page shows them.
 *
 * A failure stays here, under the button, rather than in a toast alone — a
 * toast disappears (`docs/ui/screens/README.md`, errors).
 */
export function ArchiveBuilding({
  buildingId,
  name,
  status,
}: {
  buildingId: string;
  name: string;
  status: "active" | "archived";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(action: typeof archiveBuilding, done: string) {
    setFailed(false);

    startTransition(async () => {
      const result = await action(buildingId).catch(() => ({ ok: false }));

      if (!result.ok) {
        setOpen(false);
        setFailed(true);
        return;
      }

      toast.success(done);
      router.push(`/buildings/${buildingId}`);
    });
  }

  return (
    <div className="flex max-w-160 flex-col items-start gap-2 border-t border-border-card pt-6">
      {status === "active" ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">Archive building</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Archive {name}?</DialogTitle>
              <DialogDescription>
                It keeps its history and leaves every total on the portfolio.
                You can restore it from this form.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Keep it</Button>
              </DialogClose>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => run(archiveBuilding, "Building archived.")}
              >
                {pending ? "Archiving…" : "Archive building"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => run(restoreBuilding, "Building restored.")}
        >
          {pending ? "Restoring…" : "Restore building"}
        </Button>
      )}

      <p className="text-xs leading-snug text-text-muted">
        {status === "active"
          ? "Keeps its history, and leaves it out of the portfolio’s figures."
          : "Puts it back into the portfolio’s figures."}
      </p>

      {failed ? (
        <p role="alert" className="text-xs leading-snug text-status-danger">
          {status === "active"
            ? "Couldn’t archive the building. Reload the page and try again."
            : "Couldn’t restore the building. Reload the page and try again."}
        </p>
      ) : null}
    </div>
  );
}
