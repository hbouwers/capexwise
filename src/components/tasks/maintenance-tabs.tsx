"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useOptimistic, useTransition } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MAINTENANCE_TABS, type MaintenanceTab } from "@/lib/tasks";

const LABELS: Record<MaintenanceTab, string> = {
  unscheduled: "Unscheduled",
  scheduled: "Scheduled",
  done: "Done",
};

/**
 * Maintenance's `Tabs` (`docs/ui/screens/maintenance.md`): Unscheduled,
 * Scheduled and Done, the first two with their counts, in `?tab=`. This is
 * the `SegmentedControl` use that really is tabs (`components.md` §7): it
 * changes which table shows and sets nothing.
 *
 * All three tables are rendered on the server and handed in, so switching is
 * immediate; the URL follows with `replace`, since a tab is a view of the page
 * rather than somewhere the back button should stop. The counts drop below
 * 360px, where three labels and three numbers do not fit.
 */
export function MaintenanceTabs({
  tab,
  counts,
  panels,
}: {
  tab: MaintenanceTab;
  counts: { unscheduled: number; scheduled: number };
  panels: Record<MaintenanceTab, ReactNode>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [value, setValue] = useOptimistic<MaintenanceTab>(tab);

  function choose(next: string) {
    const chosen = next as MaintenanceTab;

    startTransition(() => {
      setValue(chosen);

      const params = new URLSearchParams(searchParams);
      if (chosen === "unscheduled") params.delete("tab");
      else params.set("tab", chosen);

      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    });
  }

  return (
    <Tabs value={value} onValueChange={choose} className="gap-4">
      <TabsList className="w-full sm:w-fit">
        {MAINTENANCE_TABS.map((name) => (
          <TabsTrigger key={name} value={name} className="px-3">
            {LABELS[name]}
            {name === "done" ? null : (
              <span className="numeric text-text-muted max-[359px]:hidden">
                · {counts[name]}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      {MAINTENANCE_TABS.map((name) => (
        <TabsContent key={name} value={name}>
          {panels[name]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
