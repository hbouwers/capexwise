/**
 * The facts card's read (`docs/ui/screens/building-detail.md`, Building
 * facts): a building's days, its utilities and services with the contact each
 * names, and its access codes — without their secrets. Server-only, and it
 * starts from `getOrgContext()` like every read.
 *
 * **No query here selects `secret`.** The card renders a fixed mask and asks
 * for one code at a time, through `revealAccessCode`; neither the plaintext
 * nor the ciphertext is in the page (ADR-0008). The columns are named rather
 * than taken whole so that stays true when a column is added.
 */
import "server-only";

import { and, asc, eq } from "drizzle-orm";

import {
  buildingAccessCodes,
  buildingFacts,
  buildingUtilities,
  contacts,
} from "@/db/schema";
import type {
  AccessCodeKind,
  PaidBy,
  UtilityKind,
  Weekday,
} from "@/lib/building-facts";
import type { Cents } from "@/lib/money";
import { getOrgContext } from "@/server/org-context";

export type AccessCodeSummary = {
  id: string;
  kind: AccessCodeKind;
  label: string | null;
  unitId: string | null;
  lastRotatedAt: Date | null;
};

export type UtilityRecord = {
  id: string;
  kind: UtilityKind;
  unitId: string | null;
  providerName: string | null;
  accountRef: string | null;
  paidBy: PaidBy;
  avgMonthlyCents: Cents | null;
  /** Archived or not: a past link is still who to call until it is changed. */
  contact: { id: string; name: string; phone: string | null } | null;
};

export type BuildingFactsRecord = {
  trashDay: Weekday | null;
  recyclingDay: Weekday | null;
  recyclingNote: string | null;
  utilities: UtilityRecord[];
  accessCodes: AccessCodeSummary[];
};

/**
 * One building's facts, empty where nothing is recorded. The caller has
 * already found the building in this org — `getBuilding()` — so this takes
 * its id as a string; it filters on the org anyway, and a building in another
 * org reads as one with no facts.
 */
export async function getBuildingFacts(
  buildingId: string,
): Promise<BuildingFactsRecord> {
  const { db } = await getOrgContext();

  return await db.run(async (tx) => {
    const [facts] = await tx
      .select({
        trashDay: buildingFacts.trashDay,
        recyclingDay: buildingFacts.recyclingDay,
        recyclingNote: buildingFacts.recyclingNote,
      })
      .from(buildingFacts)
      .where(
        and(
          eq(buildingFacts.orgId, db.orgId),
          eq(buildingFacts.buildingId, buildingId),
        ),
      );

    const utilities = await tx
      .select({
        id: buildingUtilities.id,
        kind: buildingUtilities.kind,
        unitId: buildingUtilities.unitId,
        providerName: buildingUtilities.providerName,
        accountRef: buildingUtilities.accountRef,
        paidBy: buildingUtilities.paidBy,
        avgMonthlyCents: buildingUtilities.avgMonthlyCents,
        contactId: contacts.id,
        contactName: contacts.name,
        contactPhone: contacts.phone,
      })
      .from(buildingUtilities)
      // Named on both sides, `building_utilities_contact`'s shape.
      .leftJoin(
        contacts,
        and(
          eq(contacts.orgId, buildingUtilities.orgId),
          eq(contacts.id, buildingUtilities.contactId),
        ),
      )
      .where(
        and(
          eq(buildingUtilities.orgId, db.orgId),
          eq(buildingUtilities.buildingId, buildingId),
        ),
      )
      // The enum's own order — gas, electric, water, internet, trash, then
      // the services — and the order each was added within a kind, which a
      // `uuidv7()` id is.
      .orderBy(asc(buildingUtilities.kind), asc(buildingUtilities.id));

    const accessCodes = await tx
      .select({
        id: buildingAccessCodes.id,
        kind: buildingAccessCodes.kind,
        label: buildingAccessCodes.label,
        unitId: buildingAccessCodes.unitId,
        lastRotatedAt: buildingAccessCodes.lastRotatedAt,
      })
      .from(buildingAccessCodes)
      .where(
        and(
          eq(buildingAccessCodes.orgId, db.orgId),
          eq(buildingAccessCodes.buildingId, buildingId),
        ),
      )
      .orderBy(asc(buildingAccessCodes.id));

    return {
      trashDay: facts?.trashDay ?? null,
      recyclingDay: facts?.recyclingDay ?? null,
      recyclingNote: facts?.recyclingNote ?? null,
      utilities: utilities.map(
        ({ contactId, contactName, contactPhone, ...utility }) => ({
          ...utility,
          contact:
            contactId === null || contactName === null
              ? null
              : { id: contactId, name: contactName, phone: contactPhone },
        }),
      ),
      accessCodes,
    };
  });
}
