/**
 * The blended rate on the liability card (`docs/ui/screens/tax-planner.md`,
 * Estimated liability): typed as a percentage, stored in basis points
 * (`tax_years.blended_rate_bps`), for both sides of the form as every form
 * here is (`building-form.ts` says why).
 *
 * **Required, with no default** (#144, decision 2): the field is the only way
 * a rate exists, so an empty one is a message rather than a zero.
 */
import { z } from "zod";

import { type FieldErrors, UNREADABLE_FORM } from "@/lib/forms";

export type RateFields = { rate: string };

export type ValidatedRate =
  { ok: true; rateBps: number } | { ok: false; errors: FieldErrors };

const shape = z.object({ rate: z.string().max(500) });

/** `29`, `29.5`, `29.25%`: up to two decimal places, the precision stored. */
const PERCENT = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

export function validateRate(input: unknown): ValidatedRate {
  const parsed = shape.safeParse(input);
  if (!parsed.success) return { ok: false, errors: { form: UNREADABLE_FORM } };

  const typed = parsed.data.rate.trim().replace(/\s*%$/, "");
  if (typed === "") {
    return {
      ok: false,
      errors: { rate: "Enter your blended rate, as a percentage." },
    };
  }

  const match = PERCENT.exec(typed);
  if (!match) {
    return {
      ok: false,
      errors: {
        rate: "Enter the rate as a percentage, like 29 or 29.5 — two decimal places at most.",
      },
    };
  }

  const rateBps =
    Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (rateBps > 10_000) {
    return { ok: false, errors: { rate: "Enter a rate of 100% or less." } };
  }

  return { ok: true, rateBps };
}

/** `29%`, `29.5%`, `29.25%`: the rate as somebody would type it. */
export function formatRate(rateBps: number): string {
  const whole = Math.trunc(rateBps / 100);
  const fraction = String(rateBps % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");

  return fraction === "" ? `${whole}%` : `${whole}.${fraction}%`;
}
