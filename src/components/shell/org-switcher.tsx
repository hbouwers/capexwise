"use client";

import { ChevronsUpDownIcon } from "lucide-react";
import { useTransition } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import { switchOrganization } from "@/server/actions/organizations";
// Type-only, so it is erased before the bundler sees it: the module itself is
// `server-only` and could not be imported from here for real.
import type { OrgOption } from "@/server/org-context";

/**
 * The top of the rail: the org this session is acting in, and the way to change
 * it (`docs/ui/components.md` §4 — the one shell component the prototype does
 * not have, because the prototype is single-org).
 *
 * It sits where the prototype puts "My Property" over "Rental Ops": the
 * workspace's name over the product's. The product name keeps its micro-label;
 * the workspace name is the org's.
 *
 * **Both props are resolved on the server** — the current org by
 * `getOrgContext()`, the list by `listOrgsForUser()` — and this component only
 * ever sends back an id it was handed. The action treats that id as a lookup
 * into the same list rather than trusting it, so a hand-edited request can do
 * nothing a click could not.
 *
 * With one org there is nothing to switch to, and the name renders as plain
 * text rather than as a menu of one. That is the state every account is in until
 * invitations (#30), which is also when the menu gets its first real use.
 */
export function OrgSwitcher({
  current,
  orgs,
}: {
  current: OrgOption;
  orgs: OrgOption[];
}) {
  const [pending, startTransition] = useTransition();

  const name = (
    <span className="flex min-w-0 items-center gap-2.25">
      <span aria-hidden className="size-5.5 shrink-0 rounded-sm bg-accent" />
      <span className="truncate text-md leading-tight font-semibold text-text-primary">
        {current.name}
      </span>
    </span>
  );

  const product = <span className="field-label pl-7.75">CapExWise</span>;

  if (orgs.length < 2) {
    return (
      <div className="flex flex-col gap-1.5 px-5.5 pt-6.5 pb-5.5">
        {name}
        {product}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 px-3.5 pt-5 pb-5.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-busy={pending}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover-fill aria-expanded:bg-hover-fill",
            pending && "opacity-60",
          )}
        >
          {name}
          <span className="sr-only">, switch organization</span>
          <ChevronsUpDownIcon
            aria-hidden
            className="size-3.5 shrink-0 text-text-muted"
          />
        </DropdownMenuTrigger>

        <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-52">
          <DropdownMenuLabel className="field-label">
            Organizations
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={current.id}
            onValueChange={(id) => {
              if (id === current.id) return;

              // The action redirects when the switch lands, which is the
              // navigation; the transition is what keeps the old page on
              // screen, and the trigger dimmed, until it does.
              startTransition(async () => {
                await switchOrganization(id);
              });
            }}
          >
            {orgs.map((org) => (
              <DropdownMenuRadioItem key={org.id} value={org.id}>
                <span className="truncate">{org.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="px-2">{product}</span>
    </div>
  );
}
