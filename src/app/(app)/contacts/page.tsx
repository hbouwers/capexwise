import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { ContactCard } from "@/components/contacts/contact-card";
import { ContactModal } from "@/components/contacts/contact-modal";
import { TradeFilter } from "@/components/contacts/trade-filter";
import { EmptyState } from "@/components/empty-state";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { contactFields, emptyContactFields } from "@/lib/contact-form";
import { type ContactsView, contactsHref, tradesInUse } from "@/lib/contacts";
import { getOrgContext } from "@/server/org-context";
import {
  type ContactRecord,
  getContact,
  listContacts,
  listTradeTags,
} from "@/server/queries/contacts";

/**
 * The contact book (`docs/ui/screens/contacts.md`): the org's vendors and
 * professionals, filterable by trade, and the modal that adds and edits them.
 *
 * Everything a person would link to is in the URL — the trade, whether the
 * archived contacts are showing, and the contact open in the modal — so the
 * page reads the three from its search params and renders the whole view on
 * the server. The modal's contact is read here too, through the same
 * org-scoped path as the list: an id from the URL is only ever a lookup into
 * this org's contacts.
 */
export const metadata: Metadata = { title: "Contact book — CapExWise" };

/** A search param as one string: the first, if it was given more than once. */
function param(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

export default async function ContactsPage({
  searchParams,
}: PageProps<"/contacts">) {
  // The protection, not a lookup — `(app)/layout.tsx` says why each page makes
  // its own call.
  await getOrgContext();

  const params = await searchParams;
  const [trades, all] = await Promise.all([listTradeTags(), listContacts()]);
  const tradeLabels = new Map(trades.map((trade) => [trade.slug, trade.label]));

  // A trade that is not on the list filters nothing, rather than filtering to
  // nobody: it came from a hand-edited URL, not from a chip.
  const requested = param(params.trade);
  const view: ContactsView = {
    trade: requested && tradeLabels.has(requested) ? requested : null,
    archived: param(params.archived) === "1",
    contact: param(params.contact),
  };

  // The trade filters the whole page, archived contacts included: an
  // inspector under `HVAC` would be a card the filter said was not there.
  const inTrade = (contact: ContactRecord) =>
    view.trade === null || contact.trades.includes(view.trade);
  const active = all.filter((contact) => contact.archivedAt === null);
  const shown = active.filter(inTrade);
  const archived = all.filter(
    (contact) => contact.archivedAt !== null && inTrade(contact),
  );
  const chips = tradesInUse(trades, active);

  const modal = await modalFor(view);

  const hrefFor = (contact: ContactRecord) =>
    contactsHref({ ...view, contact: contact.id });

  const addContact = (
    <Button asChild>
      <Link href={contactsHref({ ...view, contact: "new" })} scroll={false}>
        Add contact
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Contact book"
        subtitle="Vendors and professionals, tagged by trade"
        actions={addContact}
      />
      <PageBody>
        <div className="flex flex-col gap-5">
          {modal === "not-found" ? (
            <p
              role="status"
              className="rounded-md border border-border-card bg-surface-subtle px-4 py-3 text-sm leading-normal text-text-secondary"
            >
              That contact wasn’t found.
            </p>
          ) : null}

          {active.length === 0 ? (
            <EmptyState
              title="No contacts yet"
              body="Add the people who work on your buildings, and tag them by trade so tasks can find them."
              action={addContact}
            />
          ) : (
            <>
              {/* No row of one `All` chip: with no trade in use, there is
                  nothing to filter by. */}
              {chips.length > 0 ? (
                <TradeFilter
                  chips={chips}
                  view={view}
                  shown={shown.length}
                  total={active.length}
                />
              ) : null}

              {shown.length === 0 ? (
                // Only reachable by URL, since a trade nobody has gets no chip.
                <div className="flex flex-col items-start gap-3 rounded-lg border border-border-card bg-surface-card px-5 py-8">
                  <p className="text-sm leading-normal text-text-secondary">
                    No contacts tagged {tradeLabels.get(view.trade!)}.
                  </p>
                  <Button variant="outline" asChild>
                    <Link
                      href={contactsHref({ ...view, trade: null })}
                      scroll={false}
                    >
                      Show all
                    </Link>
                  </Button>
                </div>
              ) : (
                <section aria-labelledby="contacts-heading">
                  <h2 id="contacts-heading" className="sr-only">
                    Contacts
                  </h2>
                  <ContactGrid>
                    {shown.map((contact) => (
                      <li key={contact.id}>
                        <ContactCard
                          contact={contact}
                          href={hrefFor(contact)}
                          tradeLabels={tradeLabels}
                        />
                      </li>
                    ))}
                  </ContactGrid>
                </section>
              )}
            </>
          )}

          {/* Archived contacts stay reachable — the modal is where one is
              restored — and stay out of the book until asked for. */}
          {archived.length > 0 ? (
            <div className="flex flex-col items-start gap-5">
              <Link
                href={contactsHref({ ...view, archived: !view.archived })}
                scroll={false}
                className="text-sm text-accent underline-offset-3 hover:underline"
              >
                {view.archived
                  ? "Hide archived"
                  : `Show archived (${archived.length})`}
              </Link>
              {view.archived ? (
                <section
                  aria-labelledby="archived-heading"
                  className="flex w-full flex-col gap-4"
                >
                  <h2
                    id="archived-heading"
                    className="text-md leading-tight font-semibold text-text-primary"
                  >
                    Archived
                  </h2>
                  <ContactGrid>
                    {archived.map((contact) => (
                      <li key={contact.id}>
                        <ContactCard
                          contact={contact}
                          href={hrefFor(contact)}
                          tradeLabels={tradeLabels}
                        />
                      </li>
                    ))}
                  </ContactGrid>
                </section>
              ) : null}
            </div>
          ) : null}
        </div>

        {modal && modal !== "not-found" ? (
          <ContactModal
            // A fresh modal per contact, so nothing typed for one carries
            // over to the next.
            key={view.contact}
            mode={modal.mode}
            initial={modal.initial}
            trades={trades}
            closeHref={contactsHref({ ...view, contact: null })}
          />
        ) : null}
      </PageBody>
    </>
  );
}

/**
 * What `?contact=` opens: a new contact, arriving with the page's trade
 * ticked; an existing one; or, for an id that is not one of this org's,
 * nothing but a line saying so — the task modal's rule, and the same line
 * for "does not exist" and "belongs to another org".
 */
async function modalFor(view: ContactsView) {
  if (view.contact === null) return null;

  if (view.contact === "new") {
    return {
      mode: { kind: "new" } as const,
      initial: emptyContactFields(view.trade ?? undefined),
    };
  }

  const contact = await getContact(view.contact);
  if (!contact) return "not-found" as const;

  return {
    mode: {
      kind: "edit",
      contactId: contact.id,
      name: contact.name,
      archived: contact.archivedAt !== null,
    } as const,
    initial: contactFields(contact),
  };
}

/**
 * `repeat(auto-fill, minmax(17rem, 1fr))` from `sm` up — three across on a
 * wide screen, as drawn — and one column below it, where a card is a phone
 * number to call.
 */
function ContactGrid({ children }: { children: ReactNode }) {
  return (
    <ul className="grid gap-3.5 sm:grid-cols-[repeat(auto-fill,minmax(17rem,1fr))]">
      {children}
    </ul>
  );
}
