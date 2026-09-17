import { StatusBadge } from "@/components/status-badge";
import { type Priority, PRIORITY_LABELS } from "@/lib/tasks";

/**
 * `PriorityPill` (`docs/ui/components.md` §6): an alias of `StatusBadge`, not
 * a component of its own. The words are the `task_priority` enum's — High
 * takes the overdue pair, Normal and Low the neutral pair, told apart by the
 * word (`maintenance.md`).
 */
export function PriorityPill({ priority }: { priority: Priority }) {
  return (
    <StatusBadge variant={priority === "high" ? "overdue" : "neutral"}>
      {PRIORITY_LABELS[priority]}
    </StatusBadge>
  );
}
