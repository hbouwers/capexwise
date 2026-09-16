import { StatusBadge, type StatusVariant } from "@/components/status-badge";
import { cn } from "@/lib/cn";
import type { LifeStatus } from "@/lib/forecast/life";

/**
 * Each life status's word, the badge it takes and the meter fill. The badges
 * are the prototype's life-state map, each on its measured pair: past life the
 * overdue pair, due soon danger, watch warning, healthy good. The fill has
 * three steps for four states, which is tokens §11's set — length carries the
 * value, and the word beside it carries the state.
 */
const STATUS: Record<
  LifeStatus,
  { label: string; badge: StatusVariant; fill: string }
> = {
  healthy: { label: "Healthy", badge: "good", fill: "bg-meter-good" },
  watch: { label: "Watch", badge: "warning", fill: "bg-meter-warn" },
  "due-soon": { label: "Due soon", badge: "danger", fill: "bg-meter-bad" },
  "past-life": { label: "Past life", badge: "overdue", fill: "bg-meter-bad" },
};

export function lifeStatusLabel(status: LifeStatus): string {
  return STATUS[status].label;
}

/** An item's status as a `StatusBadge`, in words. */
export function LifeStatusBadge({ status }: { status: LifeStatus }) {
  return (
    <StatusBadge variant={STATUS[status].badge}>
      {STATUS[status].label}
    </StatusBadge>
  );
}

/**
 * Age against expected life (`docs/ui/components.md` §6): a bar, and **always
 * the figures in text beside it** — `11 / 15 yr`. The bar is decoration for
 * a reader who can see it and is hidden from one who cannot; the text says
 * the same thing exactly, past 100% as well, where the bar stops.
 */
export function LifeBar({
  age,
  life,
  percent,
  status,
  className,
}: {
  age: number;
  life: number;
  /** Of the life used, 0 to 100 — `lifeUsedPercent`. */
  percent: number;
  status: LifeStatus;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span
        aria-hidden
        className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-meter-track"
      >
        <span
          className={cn("block h-full rounded-full", STATUS[status].fill)}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="numeric text-xs whitespace-nowrap text-text-secondary">
        {age} / {life} yr
      </span>
    </span>
  );
}
