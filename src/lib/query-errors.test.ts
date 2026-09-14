import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";

import { sqlState, withoutParameters } from "./query-errors";

/**
 * What a contact's failed insert looks like by the time it reaches an action:
 * the Postgres error, with the colliding key in its `detail`, inside Drizzle's
 * error, with every parameter in its message.
 */
function failedInsert() {
  const postgres = Object.assign(
    new Error('insert or update on table "contact_tags" violates foreign key'),
    {
      code: "23503",
      detail: "Key (tag)=(chimney-sweep) is not present in table trade_tags.",
    },
  );

  return new DrizzleQueryError(
    'insert into "contacts" ("name", "phone", "email") values ($1, $2, $3)',
    ["Dana Whitfield", "317-555-0142", "dana@example.test"],
    postgres,
  );
}

describe("withoutParameters", () => {
  it("keeps none of the query's parameters, anywhere a logger would look", () => {
    const safe = withoutParameters(failedInsert(), "Saving a contact");
    const logged = JSON.stringify({
      message: safe.message,
      stack: safe.stack,
      cause: safe.cause,
    });

    for (const value of [
      "Dana Whitfield",
      "317-555-0142",
      "dana@example.test",
      "chimney-sweep",
    ]) {
      expect(logged).not.toContain(value);
    }
    expect(safe.cause).toBeUndefined();
  });

  it("says which rule Postgres applied", () => {
    expect(withoutParameters(failedInsert(), "Saving a contact").message).toBe(
      "Saving a contact failed (SQLSTATE 23503).",
    );
  });

  it("says less when there is no SQLSTATE to give", () => {
    expect(
      withoutParameters(new Error("socket hang up"), "Saving").message,
    ).toBe("Saving failed.");
  });
});

describe("sqlState", () => {
  it("finds the code through the wrapper", () => {
    expect(sqlState(failedInsert())).toBe("23503");
  });

  it("ignores a code that is not a SQLSTATE", () => {
    // Node's own errors carry codes too, and `ECONNREFUSED` is not a rule the
    // database applied.
    expect(
      sqlState(Object.assign(new Error("connect"), { code: "ECONNREFUSED" })),
    ).toBeUndefined();
  });
});
