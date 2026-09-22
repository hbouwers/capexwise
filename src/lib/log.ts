/**
 * One structured line per event, on stdout. ADR-0013 is the decision.
 *
 * ```ts
 * logEvent({ log: "demo_reset", orgId: org.id, fields: { buildings: 5 } });
 * ```
 *
 * JSON to `console`, and nothing more clever than that. Every platform this
 * runs on — Vercel, Cloud Run, `docker compose`, a terminal — collects stdout
 * and parses JSON lines, so this is the one format that needs no agent, no
 * vendor and no transport, and it is the format that survives ADR-0002's move
 * without being re-solved. A logging library would buy levels and transports
 * that nothing here wants yet.
 *
 * Framework-free on purpose: no React, no database, no request context. That is
 * what lets the unit suite hold the two properties below, which are the only
 * reason this file exists rather than eight `JSON.stringify` calls.
 *
 * ## `orgId` is required, and may be `null`
 *
 * It is a required property of the argument, typed `string | null`. An event
 * with no org to name — a sign-in, a boot failure, the demo reset before it has
 * resolved one — passes `null` and thereby says so.
 *
 * Optional would have been easier and is the thing worth refusing. "No org" and
 * "somebody forgot" produce the same line when the field can simply be absent,
 * and a log you cannot filter by tenant is most of the way to no log at all on
 * a product where every row belongs to one (ADR-0003).
 *
 * ## Values are scrubbed on the way out
 *
 * CLAUDE.md's rule is that logs never carry PII and never carry an access code.
 * `scrub()` below enforces the recognisable half of that: an email address or a
 * run of seven or more digits is replaced by `[redacted]` in the line itself.
 *
 * **It is a backstop, not the guard.** It recognises two shapes; it cannot
 * recognise a tenant's name or a street address, and nothing pattern-matching
 * could. The guard is that call sites pass ids — `src/server/access-codes.ts`
 * is the worked example, and it is careful for reasons of its own. This catches
 * the phone number somebody adds to a line in a hurry, which is the realistic
 * failure and the one with a shape.
 *
 * It redacts rather than throws, deliberately. A logger that can take a request
 * down is worse than the leak it prevents, and a visible `[redacted]` is
 * something the person reading the log can act on — which a silently dropped
 * field is not.
 */

/** Which `console` method the line goes to. `info` unless something failed. */
export type LogLevel = "info" | "warn" | "error";

/** What a field may hold. Ids, counts, flags, enums — never an object. */
export type LogValue = string | number | boolean | null | undefined;

export type LogEntry = {
  /** The event's name, and what a query filters on. Stable, snake_case. */
  log: string;

  /**
   * The org the event happened in, or `null` where there genuinely is none.
   * Required — see the note above the file.
   */
  orgId: string | null;

  level?: LogLevel;

  /**
   * The rest of the line, spelled the way it should appear: `user_id`, not
   * `userId`. No transformation happens here, so there is no casing rule to
   * remember beyond matching the envelope.
   */
  fields?: Record<string, LogValue>;
};

/** Replaces a value that a log line should not be carrying. */
export const REDACTED = "[redacted]";

/**
 * A UUID in the canonical form, which is every id this product mints (ADR-0005).
 *
 * Checked *before* the digit rule below, and that order is load-bearing rather
 * than tidy. A UUIDv7 leads with a 48-bit timestamp rendered as hex, so a run of
 * seven digits inside one is uncommon but entirely possible — CI has already
 * produced one, which `building-facts.integration.test.ts` records. Without this
 * exemption the ids that make a log line useful would be the fields most likely
 * to come out redacted, and intermittently, which is the worst of both.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Something shaped like an email address, anywhere in the value. */
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/**
 * Seven or more consecutive digits: a phone number, an account number, an SSN.
 *
 * Seven rather than four, because four would redact a year and a unit count and
 * every other number worth logging. It does mean a short access code would pass
 * — which is why the code never reaches this function, and why
 * `src/server/access-codes.ts` says so at length rather than relying on this.
 */
const DIGIT_RUN = /\d{7,}/;

/**
 * One field value, made safe to write. Exported for the unit suite, which is
 * where the two patterns above are actually held in place.
 */
export function scrub(value: LogValue): LogValue {
  if (typeof value !== "string") return value;
  if (UUID.test(value)) return value;

  return EMAIL.test(value) || DIGIT_RUN.test(value) ? REDACTED : value;
}

/**
 * The line, as it will be written. Separate from `logEvent()` so the unit suite
 * can assert on output without capturing `console`, and so the timestamp can be
 * handed in rather than read from the clock.
 *
 * The envelope is applied *after* the fields, so a field called `log` or
 * `org_id` cannot displace the real one. That is the collision that would
 * otherwise produce a line which parses, looks ordinary, and names the wrong
 * tenant.
 */
export function formatEvent(entry: LogEntry, at: Date = new Date()): string {
  const fields = Object.fromEntries(
    Object.entries(entry.fields ?? {}).map(([key, value]) => [
      key,
      scrub(value),
    ]),
  );

  return JSON.stringify({
    ...fields,
    log: entry.log,
    level: entry.level ?? "info",
    org_id: entry.orgId,
    at: at.toISOString(),
  });
}

/**
 * Writes the event. `error` and `warn` go to `console.error` and `console.warn`
 * so that a platform splitting streams keeps the split; everything else is
 * `console.info`, which is what the access-code records have always used.
 */
export function logEvent(entry: LogEntry): void {
  const line = formatEvent(entry);

  if (entry.level === "error") console.error(line);
  else if (entry.level === "warn") console.warn(line);
  else console.info(line);
}
