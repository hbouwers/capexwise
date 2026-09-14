/**
 * A failed query, made safe to log.
 *
 * Drizzle's `DrizzleQueryError` builds its message from the query and every
 * bound parameter (ADR-0008 found it), and Next.js logs any error a server
 * action lets escape. So a contact's save that tripped a constraint would
 * write the contact's name, phone and email to the log — other people's
 * personal data, which `CLAUDE.md` says is never logged. The Postgres error
 * underneath is no better: its `detail` names the key values that collided.
 *
 * What survives here is the one thing worth knowing about the failure that is
 * not somebody's data: which rule Postgres applied, as its five-character
 * SQLSTATE. Framework-free, so the unit suite can hold it to that.
 */

/** The SQLSTATE of a Postgres error, through whatever wrapped it. */
export function sqlState(error: unknown): string | undefined {
  let current: unknown = error;

  while (current instanceof Error) {
    const { code } = current as { code?: unknown };
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;

    current = current.cause;
  }

  return undefined;
}

/**
 * An error saying that `what` failed, and with which SQLSTATE — and nothing
 * else. No `cause`, because the cause is where the parameters are, and a
 * logger that walks the chain would find them there.
 */
export function withoutParameters(error: unknown, what: string): Error {
  const state = sqlState(error);

  return new Error(
    state ? `${what} failed (SQLSTATE ${state}).` : `${what} failed.`,
  );
}
