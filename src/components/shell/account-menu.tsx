"use client";

import { LogOutIcon } from "lucide-react";
import { useTransition } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import { signOut } from "@/server/actions/auth";

/**
 * Up to two letters for the avatar: the first and last words of the name, or
 * the first letter of the address when Google sent no name. The account's own
 * photo is not used — it is a URL at Google, and rendering it means the browser
 * asks Google for it on every page, which is a request about this user to a
 * third party that nothing here needs to make.
 */
function initials(name: string, email: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0];
  const last = words.length > 1 ? words[words.length - 1]?.[0] : undefined;

  return (first ? `${first}${last ?? ""}` : (email[0] ?? "?")).toUpperCase();
}

/**
 * The prototype's user chip at the foot of the rail, and — as
 * `docs/ui/components.md` §4 says it becomes — the trigger for the account
 * menu. Sign-out lives here now rather than on the placeholder home page.
 *
 * The second line is the address rather than the prototype's "5 buildings · 8
 * doors". Those are figures, and there is nothing to count until F1.
 */
export function AccountMenu({ name, email }: { name: string; email: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-busy={pending}
        className={cn(
          "flex w-full items-center gap-2.25 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-hover-fill aria-expanded:bg-hover-fill",
          pending && "opacity-60",
        )}
      >
        <span
          aria-hidden
          className="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-surface-fill-strong text-2xs leading-none font-medium text-text-secondary"
        >
          {initials(name, email)}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm leading-tight text-text-secondary">
            {name || email}
          </span>
          <span className="truncate text-2xs leading-tight text-text-muted">
            {email}
          </span>
        </span>
        <span className="sr-only">, account menu</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="top"
        className="w-(--radix-dropdown-menu-trigger-width) min-w-52"
      >
        <DropdownMenuLabel className="truncate text-xs font-normal text-text-muted">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          // `onSelect`, not a form: a form inside the menu is unmounted by the
          // menu closing on the same click that submits it. The action
          // redirects to sign-in, which is the navigation.
          onSelect={() =>
            startTransition(async () => {
              await signOut();
            })
          }
        >
          <LogOutIcon aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
