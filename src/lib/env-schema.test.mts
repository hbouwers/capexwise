/**
 * The environment contract, tested for the two things it exists to do: fail on a
 * value the process cannot run with, and fail in a way that is safe to write to
 * a deploy log.
 *
 * The second is the one that needs a test rather than a comment. `DATABASE_URL`
 * carries a password, these messages are printed by a container on startup, and
 * deploy logs are retained and widely readable — so "never prints a value" is a
 * hard rule from CLAUDE.md, not a nicety, and a well-meant edit to
 * `formatIssues` that included the offending value for debuggability would be an
 * incident. That edit now fails here instead.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  EnvironmentError,
  migrationEnvSchema,
  parseEnv,
  serverEnvSchema,
  testEnvSchema,
} from "@/lib/env-schema.mts";

const VALID = "postgresql://user:hunter2@localhost:5432/capexwise";

describe("parseEnv", () => {
  describe("what it accepts", () => {
    it("returns the parsed values", () => {
      expect(parseEnv(serverEnvSchema, { DATABASE_URL: VALID })).toEqual({
        DATABASE_URL: VALID,
      });
    });

    it("accepts both spellings of the scheme", () => {
      const short = "postgres://user:pw@localhost:5432/capexwise";

      expect(parseEnv(serverEnvSchema, { DATABASE_URL: short })).toEqual({
        DATABASE_URL: short,
      });
    });

    it("accepts the Cloud SQL unix-socket form", () => {
      // Not hypothetical: this is how the Cloud Run escape hatch in ADR-0002
      // connects, and it is the form WHATWG `URL` rejects outright — which is
      // why the check is a regex over the scheme and not a URL parse. A
      // "thorough" rewrite of the validator would break the deploy this exists
      // to make cheap.
      const socket =
        "postgresql://user:pw@/capexwise?host=/cloudsql/project:region:instance";

      expect(parseEnv(serverEnvSchema, { DATABASE_URL: socket })).toEqual({
        DATABASE_URL: socket,
      });
    });

    it("trims surrounding whitespace", () => {
      // A trailing newline pasted into a secrets UI is invisible in it.
      expect(
        parseEnv(serverEnvSchema, { DATABASE_URL: `  ${VALID}\n` }),
      ).toEqual({ DATABASE_URL: VALID });
    });
  });

  describe("what it rejects", () => {
    it("throws an EnvironmentError, not a generic one", () => {
      // The class is what lets a caller tell a configuration problem from a bug:
      // `src/server/boot.ts` exits cleanly on this and rethrows anything else.
      expect(() => parseEnv(serverEnvSchema, {})).toThrow(EnvironmentError);
    });

    it("calls an unset variable unset", () => {
      expect(() => parseEnv(serverEnvSchema, {})).toThrow(
        /DATABASE_URL is not set/,
      );
    });

    it("calls an empty variable unset rather than invalid", () => {
      // GitHub Actions substitutes an empty string for a secret that does not
      // exist, and several hosting dashboards save a blank value happily. The
      // operator did not set it; a message about its format sends them looking
      // at the wrong thing.
      expect(() => parseEnv(serverEnvSchema, { DATABASE_URL: "" })).toThrow(
        /DATABASE_URL is not set/,
      );
    });

    it("calls a whitespace-only variable unset too", () => {
      expect(() => parseEnv(serverEnvSchema, { DATABASE_URL: "   " })).toThrow(
        /DATABASE_URL is not set/,
      );
    });

    it("calls a malformed variable invalid", () => {
      expect(() =>
        parseEnv(serverEnvSchema, { DATABASE_URL: "https://example.com" }),
      ).toThrow(/DATABASE_URL is invalid/);
    });

    it("names every variable at fault at once", () => {
      // Fixing configuration one restart at a time is the experience this
      // replaces, so a second broken variable has to appear in the first error.
      const schema = z.object({
        FIRST: z.string(),
        SECOND: z.string(),
      });

      expect(() => parseEnv(schema, {})).toThrow(/FIRST[\s\S]*SECOND/);
    });

    it("includes the hint it was given", () => {
      expect(() =>
        parseEnv(serverEnvSchema, {}, "Run `npm run db:up`."),
      ).toThrow(/Run `npm run db:up`\./);
    });
  });

  describe("what it must never print", () => {
    it("does not put the value in the message", () => {
      const secret = "https://not-a-postgres-url/with-a-secret-in-it";

      try {
        parseEnv(serverEnvSchema, { DATABASE_URL: secret });
        expect.unreachable("a malformed DATABASE_URL should throw");
      } catch (error) {
        const { message } = error as Error;

        expect(message).toContain("DATABASE_URL");
        expect(message).not.toContain(secret);
        expect(message).not.toContain("secret-in-it");
      }
    });

    it("does not leak a password through a value that is nearly valid", () => {
      // `postgres:` passes the scheme check, so this reaches the schema as a
      // present value and fails on the rest of the pattern — the path most
      // likely to echo what it was given.
      const password = "hunter2-do-not-log-me";

      try {
        parseEnv(serverEnvSchema, { DATABASE_URL: `postgres://${password}` });
        expect.unreachable("a malformed DATABASE_URL should throw");
      } catch (error) {
        expect((error as Error).message).not.toContain(password);
      }
    });
  });
});

describe("the schemas", () => {
  it("gives the migration runner a strict subset of the server's", () => {
    // The runner is not allowed to grow prerequisites the application acquires:
    // an auth secret must never become a requirement for applying a migration.
    const server = Object.keys(serverEnvSchema.shape);
    const migration = Object.keys(migrationEnvSchema.shape);

    expect(migration).toEqual(["DATABASE_URL"]);
    expect(server).toEqual(expect.arrayContaining(migration));
  });

  it("keeps the test database out of the server's schema", () => {
    // `TEST_DATABASE_URL` in `serverEnvSchema` would make a test-only variable a
    // prerequisite for booting production.
    expect(Object.keys(serverEnvSchema.shape)).not.toContain(
      "TEST_DATABASE_URL",
    );
    expect(Object.keys(testEnvSchema.shape)).toEqual(["TEST_DATABASE_URL"]);
  });

  it("holds no server variable carrying the public prefix", () => {
    // The module asserts this on load, so importing it at all is most of the
    // test. This is the assertion written down where a reader will find it: a
    // `NEXT_PUBLIC_` prefix is not a naming convention, it inlines the value
    // into the client bundle as a literal.
    for (const key of Object.keys(serverEnvSchema.shape)) {
      expect(key.startsWith("NEXT_PUBLIC_")).toBe(false);
    }
  });
});
