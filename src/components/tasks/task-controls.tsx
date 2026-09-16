"use client";

import { CheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableRow } from "@/components/ui/table";
import { type CalendarDate, formatDate } from "@/lib/dates";
import { cn } from "@/lib/cn";
import {
  completeTask,
  setTaskConfirmation,
  undoCompleteTask,
} from "@/server/actions/tasks";

/**
 * A task row's one-click writes (`docs/ui/screens/maintenance.md`,
 * `building-detail.md`): the Done checkbox, and the Scheduled tab's
 * confirmation toggle. Both take effect at once and offer Undo in a toast for
 * five seconds, the shared rule for one-click writes, and neither computes
 * anything: the page is refreshed after each, and draws the row again from
 * the server's answer.
 *
 * A failed write puts the control back and says so under the row
 * (`screens/README.md`, errors) — a toast alone disappears, and on a phone it
 * covers the control it is about.
 */

/**
 * A task row with a `Done` checkbox in its first cell: completes the task on
 * today's date at its estimate, and the toast of a recurring task says when it
 * is next due. The checkbox's name carries the task's title, because a column
 * of them read out of the table all say the same word.
 *
 * **The row is the client part, and its other cells are the server's**, passed
 * in as children — so that a failed checkoff can draw its line under the whole
 * row, `Couldn't mark this done. Try again.`, which a checkbox inside one cell
 * could not.
 */
export function CheckoffRow({
  taskId,
  title,
  spans,
  className,
  children,
}: {
  taskId: string;
  title: string;
  /**
   * The columns the row shows at each width, for the failure line: a span
   * wider than the columns shown makes columns out of nothing, and squeezes
   * the task's name to share the width with them.
   */
  spans: { span: number; className: string }[];
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [checked, setChecked] = useOptimistic(false);
  const [failed, setFailed] = useState(false);

  function complete() {
    setFailed(false);

    startTransition(async () => {
      setChecked(true);
      const result = await completeTask(taskId).catch(() => null);

      if (!result?.ok) {
        setFailed(true);
        router.refresh();
        return;
      }

      router.refresh();

      const undo = () => {
        void undoCompleteTask(taskId, result.previousActualCostCents).then(
          (undone) => {
            if (!undone.ok) {
              toast.error(
                result.next
                  ? `Couldn’t undo. ${title} is done, and its next one has changed since.`
                  : `Couldn’t undo. ${title} is still done.`,
              );
            }
            router.refresh();
          },
          () => toast.error(`Couldn’t undo. ${title} is still done.`),
        );
      };

      toast(
        result.next
          ? `${title}: done. Next due ${formatDate(result.next.dueDate)}.`
          : `${title}: done.`,
        { duration: 5000, action: { label: "Undo", onClick: undo } },
      );
    });
  }

  return (
    <>
      <TableRow
        className={cn(
          "border-border-divider hover:bg-hover-fill-subtle",
          failed && "border-b-0",
          className,
        )}
      >
        <TableCell className="w-12 pl-5 align-top">
          <Checkbox
            checked={checked}
            disabled={pending || checked}
            onCheckedChange={(next) => {
              if (next === true) complete();
            }}
            aria-label={`Done: ${title}`}
            className="mt-0.5 max-md:size-5"
          />
        </TableCell>
        {children}
      </TableRow>
      {failed ? (
        <TableRow className="border-border-divider hover:bg-transparent">
          {spans.map(({ span, className: shown }) => (
            <td
              key={span}
              colSpan={span}
              className={cn("px-5 pt-0 pb-2.5", shown)}
            >
              <p
                // Both, since only the one shown is in the accessibility tree.
                role="alert"
                className="text-2xs leading-snug text-status-danger"
              >
                Couldn’t mark this done. Try again.
              </p>
            </td>
          ))}
        </TableRow>
      ) : null}
    </>
  );
}

/**
 * The Status toggle (#93): `Awaiting confirmation` records today, and
 * `Confirmed` clears it. A `<button aria-pressed>` whose words are the state,
 * in the badge's colours — good once confirmed, warning while awaiting — so
 * the column reads as the spec's `StatusBadge` and still does something.
 *
 * Undo puts back what was there: clearing a confirmation and undoing it
 * restores the day it had, rather than recording today.
 */
export function ConfirmationToggle({
  taskId,
  title,
  confirmedOn,
}: {
  taskId: string;
  title: string;
  confirmedOn: CalendarDate | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useOptimistic(confirmedOn !== null);
  const [failed, setFailed] = useState(false);

  function toggle() {
    setFailed(false);
    const before = confirmedOn;

    startTransition(async () => {
      setConfirmed(before === null);
      const result = await setTaskConfirmation(
        taskId,
        before === null ? "today" : null,
      ).catch(() => null);

      if (!result?.ok) {
        setFailed(true);
        router.refresh();
        return;
      }

      router.refresh();
      toast(
        before === null
          ? `${title}: confirmed.`
          : `${title}: awaiting confirmation.`,
        {
          duration: 5000,
          action: {
            label: "Undo",
            onClick: () => {
              void setTaskConfirmation(taskId, before).then(
                (undone) => {
                  if (!undone.ok)
                    toast.error(`Couldn’t undo. ${title} is unchanged.`);
                  router.refresh();
                },
                () => toast.error(`Couldn’t undo. ${title} is unchanged.`),
              );
            },
          },
        },
      );
    });
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <button
        type="button"
        aria-pressed={confirmed}
        aria-label={`Confirmed with the assignee: ${title}`}
        title={
          confirmed && confirmedOn
            ? `Confirmed ${formatDate(confirmedOn, "short")}`
            : undefined
        }
        disabled={pending}
        onClick={toggle}
        className={cn(
          "inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-2xs font-medium tracking-wide whitespace-nowrap uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-70",
          confirmed
            ? "bg-tint-good text-status-good"
            : "bg-tint-warning text-status-warning",
        )}
      >
        {confirmed ? <CheckIcon aria-hidden className="size-3" /> : null}
        {confirmed ? "Confirmed" : "Awaiting confirmation"}
      </button>
      {failed ? (
        <span role="alert" className="text-2xs leading-snug text-status-danger">
          Couldn’t save. Try again.
        </span>
      ) : null}
    </span>
  );
}
