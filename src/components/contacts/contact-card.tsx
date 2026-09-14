import { MailIcon, PhoneIcon } from "lucide-react";
import Link from "next/link";

import { TradeChip } from "@/components/contacts/trade-chip";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/cn";
import { telHref } from "@/lib/contact-form";
import type { ContactRecord } from "@/server/queries/contacts";

/**
 * One contact in the book (`docs/ui/screens/contacts.md`, contact cards).
 *
 * **Not one link**, unlike a building card: it holds a phone link and an
 * email link, and links cannot nest. The name is the way in — a link to the
 * modal's URL, so it opens in place, opens in a new tab, and stays a
 * presentational component that renders on the server.
 *
 * Below `sm` the phone and the email become full-width rows at least 44px
 * tall: on a phone, calling is what the card is for.
 *
 * **No `last used` yet.** The spec's foot reads it from the most recent
 * completed task assigned to the contact, and tasks arrive with #113. Until
 * then there is nothing to derive it from, and a `not used yet` on every card
 * would be a claim the product cannot yet make either way.
 */
export function ContactCard({
  contact,
  href,
  tradeLabels,
}: {
  contact: ContactRecord;
  /** The modal's URL for this contact, keeping the page's filter. */
  href: string;
  tradeLabels: ReadonlyMap<string, string>;
}) {
  const archived = contact.archivedAt !== null;
  const phoneHref = contact.phone ? telHref(contact.phone) : null;

  return (
    <article
      className={cn(
        "flex h-full flex-col gap-3.5 rounded-lg border border-border-card bg-surface-card p-4.5",
        archived && "bg-surface-subtle",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-md leading-tight font-medium">
            <Link
              href={href}
              scroll={false}
              className="text-text-primary underline-offset-3 hover:underline"
            >
              {contact.name}
            </Link>
          </h3>
          {contact.company ? (
            <p className="text-xs leading-tight text-text-muted">
              {contact.company}
            </p>
          ) : null}
        </div>
        {archived ? (
          <StatusBadge variant="neutral">Archived</StatusBadge>
        ) : null}
      </div>

      {contact.trades.length > 0 ? (
        <ul aria-label="Trades" className="flex flex-wrap gap-1.5">
          {contact.trades.map((slug) => (
            <li key={slug}>
              <TradeChip label={tradeLabels.get(slug) ?? slug} />
            </li>
          ))}
        </ul>
      ) : null}

      {contact.phone || contact.email ? (
        <div className="flex flex-col gap-2 border-t border-border-divider pt-3 sm:gap-1.5">
          {contact.phone ? (
            phoneHref ? (
              <a href={phoneHref} className={rowClass}>
                <PhoneIcon aria-hidden className="size-3.5 text-text-muted" />
                <span className="font-mono text-sm leading-tight text-text-secondary tabular-nums">
                  {contact.phone}
                </span>
              </a>
            ) : (
              <p className="font-mono text-sm leading-tight text-text-secondary">
                {contact.phone}
              </p>
            )
          ) : null}
          {contact.email ? (
            <a href={`mailto:${contact.email}`} className={rowClass}>
              <MailIcon aria-hidden className="size-3.5 text-text-muted" />
              <span className="truncate text-xs leading-tight text-text-tertiary">
                {contact.email}
              </span>
            </a>
          ) : null}
        </div>
      ) : null}

      {contact.rateNote ? (
        <p className="mt-auto text-xs leading-snug text-text-muted">
          {contact.rateNote}
        </p>
      ) : null}
    </article>
  );
}

/**
 * A phone or email link: a 44px row with a border below `sm`, where it is a
 * thumb's target, and a plain line of text from `sm` up.
 */
const rowClass =
  "flex min-h-11 min-w-0 items-center gap-2 rounded-md border border-border-control px-3 hover:border-hover-border sm:min-h-0 sm:rounded-none sm:border-0 sm:px-0 sm:hover:underline";
