"use server";

/**
 * The rent roll's writes (`docs/ui/screens/building-detail.md`, Units &
 * rent): `Mark paid`, un-marking, the Other amount form, and `Record rent` for
 * a unit with no period that month. Each starts with `getOrgContext()`, so the
 * org is the session's, and every id the browser sends — a period, a unit —
 * is looked up inside that org rather than trusted.
 *
 * **Only an active building's rent roll is written to.** An archived or sold
 * building is kept for its history and shown without controls, and these
 * refuse it the same way they refuse a period that is not there, so a
 * request cannot tell the two apart.
 *
 * "Today" is today where the building is (ADR-0005), read inside the write,
 * because it decides the date `Mark paid` records and the latest date a
 * payment can have.
 */

import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { buildings, rentPeriods, units } from "@/db/schema";
import { type CalendarDate, isCalendarDate, todayIn } from "@/lib/dates";
import { type FieldErrors, UNREADABLE_FORM } from "@/lib/forms";
import { withoutParameters } from "@/lib/query-errors";
import { paidOn, rentRollMonths } from "@/lib/rent";
import { validateRentPeriod } from "@/lib/rent-period-form";
import { getOrgContext, type OrgScopedTx } from "@/server/org-context";

export type RentWriteResult = { ok: true } | { ok: false };

export type SaveRentPeriodResult =
  { ok: true } | { ok: false; errors: FieldErrors };

/**
 * One message for a period that is not there, one that is another org's, and
 * one whose building has been archived since the page was drawn — the roll
 * that sent it is out of date in every case, and reloading is the fix.
 */
const NOT_FOUND =
  "This month could not be saved. Reload the page — it may have changed since you opened it.";

/** A month opened by somebody else between the page drawing and the click. */
const ALREADY_OPEN =
  "This month already has rent recorded. Reload the page to see it.";

const idSchema = z.uuid();

function refused(message: string): SaveRentPeriodResult {
  return { ok: false, errors: { form: message } };
}

/**
 * The period and what the rules need of its building, locked for the length
 * of the write so a mark and an un-mark of one row cannot interleave. `null`
 * for a period that is not this org's or whose building is not active.
 */
async function lockPeriod(tx: OrgScopedTx, orgId: string, periodId: string) {
  const [row] = await tx
    .select({
      id: rentPeriods.id,
      periodMonth: rentPeriods.periodMonth,
      amountExpectedCents: rentPeriods.amountExpectedCents,
      amountReceivedCents: rentPeriods.amountReceivedCents,
      vacant: rentPeriods.vacant,
      timezone: buildings.timezone,
    })
    .from(rentPeriods)
    .innerJoin(
      buildings,
      and(
        eq(buildings.orgId, rentPeriods.orgId),
        eq(buildings.id, rentPeriods.buildingId),
      ),
    )
    .where(
      and(
        eq(rentPeriods.orgId, orgId),
        eq(rentPeriods.id, periodId),
        eq(buildings.status, "active"),
      ),
    )
    .for("update", { of: rentPeriods });

  return row ?? null;
}

/**
 * One click: the expected amount, received — today for the current month,
 * the period's first day for an earlier one (`paidOn`). Only on a month not
 * marked yet: a second click, or one on a month somebody marked meanwhile, is
 * refused rather than repeated, so its `Undo` cannot clear somebody else's
 * payment.
 */
export async function markRentPaid(
  periodId: unknown,
): Promise<RentWriteResult> {
  const { db } = await getOrgContext();

  const id = idSchema.safeParse(periodId);
  if (!id.success) return { ok: false };

  return await db.run(async (tx) => {
    const period = await lockPeriod(tx, db.orgId, id.data);
    if (!period || period.vacant || period.amountReceivedCents !== null) {
      return { ok: false };
    }

    await tx
      .update(rentPeriods)
      .set({
        amountReceivedCents: period.amountExpectedCents,
        receivedOn: paidOn(period.periodMonth, todayIn(period.timezone)),
      })
      .where(and(eq(rentPeriods.orgId, db.orgId), eq(rentPeriods.id, id.data)));

    return { ok: true };
  });
}

/**
 * Pressing `Paid` again: the month goes back to not marked. The expected
 * amount and the note stay. The toast's `Undo` puts the payment back through
 * `saveRentPeriod`, with the row as it was drawn.
 */
export async function unmarkRentPaid(
  periodId: unknown,
): Promise<RentWriteResult> {
  const { db } = await getOrgContext();

  const id = idSchema.safeParse(periodId);
  if (!id.success) return { ok: false };

  return await db.run(async (tx) => {
    const period = await lockPeriod(tx, db.orgId, id.data);
    if (!period || period.amountReceivedCents === null) return { ok: false };

    await tx
      .update(rentPeriods)
      .set({ amountReceivedCents: null, receivedOn: null })
      .where(and(eq(rentPeriods.orgId, db.orgId), eq(rentPeriods.id, id.data)));

    return { ok: true };
  });
}

/**
 * The Other amount form: what arrived and when, the expected amount — which
 * is how a rent change entered after the month opened is corrected (§4) — a
 * note, and whether the unit stood empty that month (#97).
 *
 * A failed write is re-thrown with its SQLSTATE only: the note is free text,
 * and may name a tenant, which `CLAUDE.md` says is never logged.
 */
export async function saveRentPeriod(
  periodId: unknown,
  input: unknown,
): Promise<SaveRentPeriodResult> {
  const { db } = await getOrgContext();

  const id = idSchema.safeParse(periodId);
  if (!id.success) return refused(NOT_FOUND);

  try {
    return await db.run(async (tx): Promise<SaveRentPeriodResult> => {
      const period = await lockPeriod(tx, db.orgId, id.data);
      if (!period) return refused(NOT_FOUND);

      const validated = validateRentPeriod(input, todayIn(period.timezone));
      if (!validated.ok) return validated;

      await tx
        .update(rentPeriods)
        .set(validated.values)
        .where(
          and(eq(rentPeriods.orgId, db.orgId), eq(rentPeriods.id, id.data)),
        );

      return { ok: true };
    });
  } catch (error) {
    throw withoutParameters(error, "Saving a rent period");
  }
}

/**
 * `Record rent`: a month for a unit that has none — vacant now but let then,
 * or occupied with no rent entered — opened on request with the expected
 * amount typed rather than snapshotted (data-model §4, #97).
 *
 * The month has to be one the rent roll can show for the unit's building, and
 * the unit one that is not retired. It is opened as a month with rent in it,
 * never as a vacant one: a unit with no period already reads `Vacant`, and
 * the form does not offer the box.
 */
export async function openRentPeriod(
  unitId: unknown,
  month: unknown,
  input: unknown,
): Promise<SaveRentPeriodResult> {
  const { db } = await getOrgContext();

  const id = idSchema.safeParse(unitId);
  if (!id.success || !isMonth(month)) return refused(NOT_FOUND);

  try {
    return await db.run(async (tx): Promise<SaveRentPeriodResult> => {
      const [unit] = await tx
        .select({
          id: units.id,
          buildingId: units.buildingId,
          timezone: buildings.timezone,
          acquiredOn: buildings.acquiredOn,
        })
        .from(units)
        .innerJoin(
          buildings,
          and(
            eq(buildings.orgId, units.orgId),
            eq(buildings.id, units.buildingId),
          ),
        )
        .where(
          and(
            eq(units.orgId, db.orgId),
            eq(units.id, id.data),
            ne(units.status, "retired"),
            eq(buildings.status, "active"),
          ),
        )
        // The building form's save updates the unit to retire it, so it
        // waits here — a form drawn before the retirement cannot give the
        // unit a month after it.
        .for("update", { of: units });

      if (!unit) return refused(NOT_FOUND);

      const today = todayIn(unit.timezone);
      const { earliest, current } = rentRollMonths(today, unit.acquiredOn);
      if (month < earliest || month > current) return refused(NOT_FOUND);

      const validated = validateRentPeriod(input, today);
      if (!validated.ok) return validated;
      if (validated.values.vacant) return refused(UNREADABLE_FORM);

      // The same conflict target as `ensureRentPeriods`, so a month opened by
      // a view a moment ago is not opened twice — it is reported instead.
      const opened = await tx
        .insert(rentPeriods)
        .values({
          orgId: db.orgId,
          buildingId: unit.buildingId,
          unitId: unit.id,
          periodMonth: month,
          ...validated.values,
        })
        .onConflictDoNothing({
          target: [
            rentPeriods.orgId,
            rentPeriods.unitId,
            rentPeriods.periodMonth,
          ],
        })
        .returning({ id: rentPeriods.id });

      return opened.length === 1 ? { ok: true } : refused(ALREADY_OPEN);
    });
  } catch (error) {
    throw withoutParameters(error, "Recording a month's rent");
  }
}

/** `2026-03-01`: the first of a real month, which is all a period may be. */
function isMonth(value: unknown): value is CalendarDate {
  return (
    typeof value === "string" && isCalendarDate(value) && value.endsWith("-01")
  );
}
