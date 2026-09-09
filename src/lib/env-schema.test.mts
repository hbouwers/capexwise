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

/**
 * A complete, valid server environment, with `overrides` applied on top.
 *
 * `serverEnvSchema` is not one variable and never was — every test below is
 * about one of them, and without this every one of them would also have to
 * restate the other four. The consequence worth naming: a variable added to the
 * schema and not to this object turns every test in the file red at once, with a
 * message naming the variable. That is the intended failure, not an annoyance to
 * route around.
 */
function serverEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    DATABASE_URL: VALID,
    APP_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "x".repeat(32),
    GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "client-secret",
    ...overrides,
  };
}

describe("parseEnv", () => {
  describe("what it accepts", () => {
    it("returns the parsed values", () => {
      expect(parseEnv(serverEnvSchema, serverEnv())).toEqual(serverEnv());
    });

    it("accepts both spellings of the scheme", () => {
      const short = "postgres://user:pw@localhost:5432/capexwise";

      expect(
        parseEnv(serverEnvSchema, serverEnv({ DATABASE_URL: short })),
      ).toEqual(serverEnv({ DATABASE_URL: short }));
    });

    it("accepts the Cloud SQL unix-socket form", () => {
      // Not hypothetical: this is how the Cloud Run escape hatch in ADR-0002
      // connects, and it is the form WHATWG `URL` rejects outright — which is
      // why the check is a regex over the scheme and not a URL parse. A
      // "thorough" rewrite of the validator would break the deploy this exists
      // to make cheap.
      const socket =
        "postgresql://user:pw@/capexwise?host=/cloudsql/project:region:instance";

      expect(
        parseEnv(serverEnvSchema, serverEnv({ DATABASE_URL: socket })),
      ).toEqual(serverEnv({ DATABASE_URL: socket }));
    });

    it("trims surrounding whitespace", () => {
      // A trailing newline pasted into a secrets UI is invisible in it.
      expect(
        parseEnv(serverEnvSchema, serverEnv({ DATABASE_URL: `  ${VALID}\n` })),
      ).toEqual(serverEnv());
    });

    it("accepts an APP_URL on either scheme, with a port", () => {
      // `http` because that is what local development is, and a schema that
      // demanded `https` would be one every developer has to work around.
      for (const origin of [
        "http://localhost:3000",
        "https://capexwise.com",
        "https://capexwise-git-feat-x.vercel.app",
      ]) {
        expect(
          parseEnv(serverEnvSchema, serverEnv({ APP_URL: origin })),
        ).toEqual(serverEnv({ APP_URL: origin }));
      }
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

    it("rejects an APP_URL with a trailing slash", () => {
      // Better Auth concatenates its base path onto this, so a trailing slash
      // produces `//api/auth/...` — which most hosts serve and Google's
      // redirect-URI matching treats as a different URI. The failure lands at
      // the provider, saying nothing about us.
      expect(() =>
        parseEnv(serverEnvSchema, serverEnv({ APP_URL: "https://x.com/" })),
      ).toThrow(/APP_URL is invalid/);
    });

    it("rejects an APP_URL that is a path rather than an origin", () => {
      expect(() =>
        parseEnv(serverEnvSchema, serverEnv({ APP_URL: "capexwise.com" })),
      ).toThrow(/APP_URL is invalid/);
    });

    it("rejects a short BETTER_AUTH_SECRET", () => {
      // 32 characters is Better Auth's own floor. Checking it here means a short
      // value fails at boot, naming the variable, rather than at the first
      // sign-in.
      expect(() =>
        parseEnv(serverEnvSchema, serverEnv({ BETTER_AUTH_SECRET: "short" })),
      ).toThrow(/BETTER_AUTH_SECRET is invalid/);
    });

    it("names the Google client variables when they are absent", () => {
      // ADR-0004 makes Google the only way in during v0, so an instance without
      // these is an application nobody can enter.
      expect(() =>
        parseEnv(
          serverEnvSchema,
          serverEnv({ GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: "" }),
        ),
      ).toThrow(/GOOGLE_CLIENT_ID is not set[\s\S]*GOOGLE_CLIENT_SECRET/);
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

    it("does not leak the auth secret when it is rejected for length", () => {
      // The one variable in the schema whose *whole value* is a secret, and the
      // one rejected by a rule about the value itself rather than its shape —
      // so a message that helpfully showed what it got would print the secret in
      // full. `BETTER_AUTH_SECRET` signs every session cookie and encrypts the
      // OAuth tokens in `accounts`.
      const secret = "too-short-but-still-a-real-secret";

      try {
        parseEnv(
          serverEnvSchema,
          serverEnv({ BETTER_AUTH_SECRET: secret.slice(0, 20) }),
        );
        expect.unreachable("a short BETTER_AUTH_SECRET should throw");
      } catch (error) {
        const { message } = error as Error;

        expect(message).toContain("BETTER_AUTH_SECRET");
        expect(message).not.toContain(secret.slice(0, 20));
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
