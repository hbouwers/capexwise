/**
 * The demo org: finding it, and writing it again every night (#34). A visitor
 * is let into it by the session hook in `src/server/auth.ts`.
 * [ADR-0011](../../docs/adr/0011-demo-org.md) is the decision; this is the only
 * code that acts on an org nobody is signed in to.
 *
 * **It is on the ESLint allowlist, and what it can reach is small.** Every
 * statement here is one of three shapes:
 *
 * - A read of `organizations` for the one row with `is_demo`, on the identity
 *   path, where `resolveOrgForUser()` already reads it.
 * - The reset's deletes: the demo org, `where is_demo`, and the anonymous
 *   users, `where is_anonymous`. Both on the identity path, whose grants have
 *   covered those two tables since #28. The org's rows go with it by
 *   `on delete cascade`, which Postgres runs as a referential action rather
 *   than as a query of ours, so no policy has to admit them.
 * - The content, written after `enterOrg()` has made the transaction
 *   `capexwise_scoped` in the demo org — so the policies hold every row of it
 *   to that org exactly as they would a request's.
 *
 * Nothing here takes an org id from anywhere but the `is_demo` row.
 */
import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db as unscopedDb } from "@/db/client";
import {
  buildingAccessCodes,
  buildingFacts,
  buildings,
  buildingUtilities,
  capitalItems,
  plannedWork,
  contacts,
  contactTags,
  organizations,
  rentPeriods,
  tasks,
  transactions,
  units,
  users,
} from "@/db/schema";
import { sealAccessCode } from "@/lib/access-code-cipher.mts";
import { type CalendarDate, todayIn, yearOf } from "@/lib/dates";
import {
  DEMO_TIME_ZONE,
  type DemoBuilding,
  demoExpenses,
  demoPortfolio,
} from "@/lib/demo-portfolio";
import { keyring } from "@/server/access-codes";
import { enterOrg, type OrgScopedTx } from "@/server/org-context";

/**
 * The demo org's slug. Fixed rather than generated like a customer's, because
 * there is only ever one (`organizations_one_demo`) and a stable slug is what
 * a reset recreates.
 */
export const DEMO_ORG_SLUG = "demo";

/**
 * The id of the demo org, or `null` where nothing has seeded one or it has
 * been soft-deleted — the `deleted_at is null` `resolveOrgForUser()` applies,
 * so the sign-in page never offers a demo `getOrgContext()` would not open.
 */
export async function findDemoOrgId(): Promise<string | null> {
  const [row] = await unscopedDb()
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.isDemo, true), isNull(organizations.deletedAt)))
    .limit(1);

  return row?.id ?? null;
}

export type DemoResetSummary = {
  orgId: string;
  buildings: number;
  visitorsRemoved: number;
};

/**
 * Deletes the demo org and everything in it, deletes every anonymous visitor,
 * and writes the demo again as of `now` — **in one transaction**, so a seed
 * that fails leaves last night's demo in place rather than an empty one. Run
 * it twice and the second run leaves the same demo the first did: that is the
 * whole of what "idempotent" means for a script whose job is to start over.
 *
 * The org keeps its id across a reset. Nothing depends on that today; it
 * costs nothing, and a link into the demo's own pages is the kind of thing
 * that ends up pasted in a README.
 */
export async function resetDemoOrg(
  now: Date = new Date(),
): Promise<DemoResetSummary> {
  const today = todayIn(DEMO_TIME_ZONE, now);
  const portfolio = demoPortfolio(today);

  return await unscopedDb().transaction(async (tx) => {
    const existing = await tx
      .delete(organizations)
      .where(eq(organizations.isDemo, true))
      .returning({ id: organizations.id });

    // Every anonymous account is a demo visitor — nothing else creates one —
    // so they go with the demo. Their sessions and memberships cascade.
    const removed = await tx
      .delete(users)
      .where(eq(users.isAnonymous, true))
      .returning({ id: users.id });

    const [org] = await tx
      .insert(organizations)
      .values({
        ...(existing[0] ? { id: existing[0].id } : {}),
        name: portfolio.orgName,
        slug: DEMO_ORG_SLUG,
        isDemo: true,
        reserveBalanceCents: portfolio.reserve.balanceCents,
        reserveAsOf: portfolio.reserve.asOf,
        reserveMonthlyContributionCents:
          portfolio.reserve.monthlyContributionCents,
      })
      .returning({ id: organizations.id });

    if (!org) throw new Error("Recreating the demo org returned no row.");

    // From here the transaction is the scoped role in the demo org, and stays
    // it until the commit: nothing below can write outside it.
    await enterOrg(tx, org.id);

    const contactIds = await writeContacts(tx, org.id, portfolio.contacts);

    for (const [index, building] of portfolio.buildings.entries()) {
      await writeBuilding(tx, org.id, building, contactIds, {
        today,
        first: index === 0,
      });
    }

    return {
      orgId: org.id,
      buildings: portfolio.buildings.length,
      visitorsRemoved: removed.length,
    };
  });
}

async function writeContacts(
  tx: OrgScopedTx,
  orgId: string,
  demo: ReturnType<typeof demoPortfolio>["contacts"],
): Promise<Map<string, string>> {
  const rows = await tx
    .insert(contacts)
    .values(
      demo.map(({ name, company, phone, email, rateNote }) => ({
        orgId,
        name,
        company,
        phone,
        email,
        rateNote,
      })),
    )
    .returning({ id: contacts.id });

  const ids = new Map(demo.map((contact, i) => [contact.key, rows[i]!.id]));

  await tx.insert(contactTags).values(
    demo.flatMap((contact) =>
      contact.tags.map((tag) => ({
        orgId,
        contactId: ids.get(contact.key)!,
        tag,
      })),
    ),
  );

  return ids;
}

/** A key the content refers to, or a throw naming it — never a silent null. */
function idFor(ids: Map<string, string>, key: string, what: string): string {
  const id = ids.get(key);
  if (!id)
    throw new Error(`The demo content names an unknown ${what}: ${key}.`);

  return id;
}

async function writeBuilding(
  tx: OrgScopedTx,
  orgId: string,
  demo: DemoBuilding,
  contactIds: Map<string, string>,
  { today, first }: { today: CalendarDate; first: boolean },
): Promise<void> {
  const [building] = await tx
    .insert(buildings)
    .values({
      orgId,
      label: demo.label,
      addressLine1: demo.addressLine1,
      city: demo.city,
      region: demo.region,
      postalCode: demo.postalCode,
      timezone: DEMO_TIME_ZONE,
      buildYear: demo.buildYear,
      ...(demo.basis
        ? {
            ...demo.basis,
            inServiceOn: demo.basis.acquiredOn,
            basisSplitMethod: "assessment_ratio" as const,
          }
        : {}),
    })
    .returning({ id: buildings.id });

  if (!building) throw new Error("Writing a demo building returned no row.");

  const buildingId = building.id;

  const unitRows = await tx
    .insert(units)
    .values(
      demo.units.map((unit) => ({
        orgId,
        buildingId,
        label: unit.label,
        status: unit.status,
        rentCents: unit.rentCents,
        leaseEnd: unit.leaseEnd,
        bedrooms: unit.bedrooms,
        bathrooms: unit.bathrooms,
        squareFeet: unit.squareFeet,
      })),
    )
    .returning({ id: units.id });

  const unitIds = new Map(
    demo.units.map((unit, i) => [unit.key, unitRows[i]!.id]),
  );
  const unit = (key: string | undefined) =>
    key === undefined ? null : idFor(unitIds, key, "unit");
  const contact = (key: string | undefined) =>
    key === undefined ? null : idFor(contactIds, key, "contact");

  await tx.insert(buildingFacts).values({ orgId, buildingId, ...demo.facts });

  await tx.insert(buildingUtilities).values(
    demo.utilities.map(({ contact: contactKey, ...utility }) => ({
      orgId,
      buildingId,
      ...utility,
      contactId: contact(contactKey),
    })),
  );

  await tx.insert(buildingAccessCodes).values(
    demo.accessCodes.map(({ code, unit: unitKey, kind, label }) => ({
      orgId,
      buildingId,
      unitId: unit(unitKey),
      kind,
      label,
      ...sealAccessCode(keyring(), orgId, code),
    })),
  );

  for (const { unit: unitKey, replaced, plannedIn, ...item } of demo.items) {
    const unitId = unit(unitKey);
    const scope = unitId
      ? { unitId, allocation: "building_only" as const }
      : { unitId: null };

    const [current] = await tx
      .insert(capitalItems)
      .values({
        orgId,
        buildingId,
        ...scope,
        ...item,
        confidence: item.installDate ? "audited" : "estimated",
      })
      .returning({ id: capitalItems.id });

    if (replaced && current) {
      await tx.insert(capitalItems).values({
        orgId,
        buildingId,
        ...scope,
        typeSlug: item.typeSlug,
        label: item.label,
        installYear: replaced.installYear,
        expectedLifeYears: item.expectedLifeYears,
        replacementCostCents: item.replacementCostCents,
        actualCostCents: replaced.actualCostCents,
        status: "replaced",
        replacedById: current.id,
      });
    }

    if (plannedIn !== undefined && current) {
      await tx.insert(plannedWork).values({
        orgId,
        buildingId,
        capitalItemId: current.id,
        plannedYear: yearOf(today) + plannedIn,
      });
    }
  }

  const taskRows = await tx
    .insert(tasks)
    .values(
      demo.tasks.map(({ unit: unitKey, contact: contactKey, ...task }) => ({
        orgId,
        buildingId,
        ...task,
        unitId: unit(unitKey),
        assigneeContactId: contact(contactKey),
      })),
    )
    .returning({ id: tasks.id });

  const expenses = demoExpenses(today, demo, first);
  if (expenses.length > 0) {
    await tx.insert(transactions).values(
      expenses.map((expense) => ({
        orgId,
        buildingId,
        unitId: unit(expense.unit),
        contactId: contact(expense.contact),
        taskId: expense.task === undefined ? null : taskRows[expense.task]!.id,
        occurredOn: expense.occurredOn,
        amountCents: expense.amountCents,
        description: expense.description,
        scheduleECategory: expense.category,
        classification: expense.classification,
      })),
    );
  }

  await tx.insert(rentPeriods).values(
    demo.rent.map(({ unit: unitKey, ...period }) => ({
      orgId,
      buildingId,
      unitId: idFor(unitIds, unitKey, "unit"),
      ...period,
    })),
  );
}
