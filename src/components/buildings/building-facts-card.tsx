import { PhoneIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  BuildingFactsEditor,
  type ContactOption,
  type UnitOption,
} from "@/components/buildings/building-facts-editor";
import { FactGroup, FactRow } from "@/components/buildings/fact-group";
import { MaskedValue } from "@/components/buildings/masked-value";
import { Money } from "@/components/money";
import { Numeric } from "@/components/numeric";
import { ScopeLabel } from "@/components/scope-label";
import {
  accessCodeName,
  isService,
  ownerPaidMonthlyCents,
  UTILITY_KIND_LABELS,
  WEEKDAY_NAMES,
} from "@/lib/building-facts";
import { buildingFactsFields } from "@/lib/building-facts-form";
import { telHref } from "@/lib/contact-form";
import { formatDate, todayIn } from "@/lib/dates";
import type {
  BuildingFactsRecord,
  UtilityRecord,
} from "@/server/queries/building-facts";

/**
 * The Building facts card (`docs/ui/screens/building-detail.md`): where the
 * lockbox code gets looked up at 11pm. Four groups — Access, Services, Utility
 * accounts, Average bill — four across when the card is at least 56rem wide,
 * two from 32rem and one below. The card's own width, not the viewport's, as
 * every region that reflows on this page is (`screens/README.md`).
 *
 * It renders on the server. The codes are ids and names here and nothing
 * more; each `MaskedValue` asks for its own code when somebody presses
 * `Reveal`. The editor is the one other client part, and it opens with
 * every code's field empty.
 */
export function BuildingFactsCard({
  buildingId,
  timezone,
  facts,
  units,
  contacts,
}: {
  buildingId: string;
  /** The building's zone, which a code's `changed` month is read in. */
  timezone: string;
  facts: BuildingFactsRecord;
  /** Every unit, retired ones included, in label order. */
  units: readonly (UnitOption & { retired: boolean })[];
  contacts: readonly ContactOption[];
}) {
  const unitLabels = new Map(units.map((unit) => [unit.id, unit.label]));
  const current = units.filter((unit) => !unit.retired);
  // A single-unit building shows no scope at all (`screens/README.md`).
  const multiUnit = current.length > 1;

  function scopeOf(unitId: string | null): ReactNode {
    const label = unitId === null ? undefined : unitLabels.get(unitId);

    return multiUnit && label ? <ScopeLabel>{label}</ScopeLabel> : null;
  }

  const services = facts.utilities.filter((u) => isService(u.kind));
  const accounts = facts.utilities.filter((u) => !isService(u.kind));
  const billed = facts.utilities.filter((u) => u.avgMonthlyCents !== null);

  const recycling = facts.recyclingDay
    ? WEEKDAY_NAMES[facts.recyclingDay]
    : facts.recyclingNote;

  return (
    <section
      aria-labelledby="facts-heading"
      className="@container overflow-hidden rounded-lg border border-border-card bg-surface-card"
    >
      <div className="flex items-center justify-between gap-4 border-b border-border-divider px-5 py-3">
        <h2
          id="facts-heading"
          className="text-md leading-tight font-semibold text-text-primary"
        >
          Building facts
        </h2>
        <BuildingFactsEditor
          buildingId={buildingId}
          initial={buildingFactsFields(facts)}
          // A retired unit is offered only to the rows already on it, so a
          // save does not move them; nothing new is put on one.
          units={units.filter(
            (unit) =>
              !unit.retired ||
              facts.utilities.some((row) => row.unitId === unit.id) ||
              facts.accessCodes.some((row) => row.unitId === unit.id),
          )}
          multiUnit={multiUnit}
          contacts={contacts}
        />
      </div>

      <div className="grid gap-x-8 gap-y-7 px-5 py-5 @lg:grid-cols-2 @4xl:grid-cols-4">
        <FactGroup title="Access" empty={facts.accessCodes.length === 0}>
          {facts.accessCodes.map((code) => {
            const name = accessCodeName(code);

            return (
              <FactRow
                key={code.id}
                label={name}
                scope={scopeOf(code.unitId)}
                value={<MaskedValue accessCodeId={code.id} name={name} />}
                note={
                  code.lastRotatedAt
                    ? `changed ${formatDate(todayIn(timezone, code.lastRotatedAt), "month")}`
                    : null
                }
              />
            );
          })}
        </FactGroup>

        <FactGroup
          title="Services"
          empty={
            facts.trashDay === null && recycling === null && !services.length
          }
        >
          {facts.trashDay ? (
            <FactRow label="Trash" value={WEEKDAY_NAMES[facts.trashDay]} />
          ) : null}
          {recycling ? (
            <FactRow
              label="Recycling"
              value={recycling}
              note={facts.recyclingDay ? facts.recyclingNote : null}
            />
          ) : null}
          {services.map((service) => (
            <ServiceRow key={service.id} service={service} />
          ))}
        </FactGroup>

        <FactGroup title="Utility accounts" empty={accounts.length === 0}>
          {accounts.map((account) => (
            <FactRow
              key={account.id}
              label={UTILITY_KIND_LABELS[account.kind]}
              scope={scopeOf(account.unitId)}
              value={
                <>
                  {account.providerName ?? "Provider not recorded"}
                  {account.accountRef ? (
                    <>
                      {" · "}
                      <span className="text-text-secondary">
                        acct <Numeric>••{account.accountRef}</Numeric>
                      </span>
                    </>
                  ) : null}
                </>
              }
              note={account.paidBy === "tenant" ? "tenant-paid" : null}
            />
          ))}
        </FactGroup>

        <FactGroup title="Average bill" empty={billed.length === 0}>
          {billed.map((utility) => (
            <FactRow
              key={utility.id}
              label={UTILITY_KIND_LABELS[utility.kind]}
              scope={scopeOf(utility.unitId)}
              value={
                <span className="flex items-baseline gap-1.5">
                  <Money cents={utility.avgMonthlyCents!} />
                  <span className="text-xs text-text-muted">/mo</span>
                  {utility.paidBy === "tenant" ? (
                    <span className="text-xs text-text-muted">tenant</span>
                  ) : null}
                </span>
              }
            />
          ))}
          {/* Beneath a rule, and only what the owner pays: a tenant's bill
              is listed above and left out here. */}
          <div className="flex items-baseline justify-between gap-3 border-t border-border-divider pt-3">
            <dt className="text-xs leading-snug font-medium text-text-secondary">
              Owner-paid
            </dt>
            <dd className="flex items-baseline gap-1.5 text-sm font-medium text-text-primary">
              <Money cents={ownerPaidMonthlyCents(billed)} />
              <span className="text-xs font-normal text-text-muted">/mo</span>
            </dd>
          </div>
        </FactGroup>
      </div>
    </section>
  );
}

/**
 * A lawn or snow row: who does it, and how to reach the person — the linked
 * contact's name, and their phone as a `tel:` link. The company leads when
 * there is one; a contact with no company is the whole value.
 */
function ServiceRow({ service }: { service: UtilityRecord }) {
  const contact = service.contact;
  const phone = contact?.phone ?? null;
  const href = phone ? telHref(phone) : null;

  const reach = contact ? (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {service.providerName ? <span>{contact.name}</span> : null}
      {phone ? (
        href ? (
          <a
            href={href}
            className="inline-flex min-h-11 items-center gap-1.5 text-accent underline-offset-3 hover:underline md:min-h-0"
          >
            <PhoneIcon aria-hidden className="size-3" />
            <Numeric>{phone}</Numeric>
          </a>
        ) : (
          <Numeric>{phone}</Numeric>
        )
      ) : null}
    </span>
  ) : null;

  return (
    <FactRow
      label={UTILITY_KIND_LABELS[service.kind]}
      value={service.providerName ?? contact?.name}
      note={reach}
    />
  );
}
