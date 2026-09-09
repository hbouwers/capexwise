/**
 * Reading a constraint violation back out of whatever Drizzle wrapped it in.
 *
 * A database-backed test that asserts on an error message is asserting on a
 * string Postgres is free to reword and a locale is free to translate. The
 * five-character `SQLSTATE` is the stable thing, so these tests assert on that
 * and the constants below name the ones the schema can actually raise.
 */

/** Two rows collided on a unique index or constraint. */
export const UNIQUE_VIOLATION = "23505";

/** A foreign key had no referent — a row pointing at something not there. */
export const FOREIGN_KEY_VIOLATION = "23503";

/**
 * `on delete restrict` refused a delete. A distinct code from
 * `FOREIGN_KEY_VIOLATION`, and the distinction is the point: `restrict` raises
 * this immediately, where the `no action` Postgres would have given us by
 * default raises 23503 at constraint-check time instead. A test that accepts
 * either cannot tell which of the two `docs/data-model.md` §7 actually got.
 */
export const RESTRICT_VIOLATION = "23001";

/** A `check` constraint rejected the row. */
export const CHECK_VIOLATION = "23514";

/**
 * Postgres error codes reach us through however many layers Drizzle wraps them
 * in, and that depth is a detail of the ORM version rather than something a test
 * should assert on. Walking the `cause` chain keeps these tests about Postgres.
 */
export function postgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;

  while (current instanceof Error) {
    const { code } = current as { code?: unknown };
    if (typeof code === "string") return code;

    current = current.cause;
  }

  return undefined;
}

/**
 * A matcher body for `rejects.toSatisfy`, so the three-line closure that spells
 * this out does not appear once per assertion.
 */
export function rejectsWith(code: string): (error: unknown) => boolean {
  return (error: unknown) => postgresErrorCode(error) === code;
}
