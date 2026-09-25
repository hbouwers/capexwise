/**
 * The validated public environment — the half of the configuration that is
 * allowed to reach a browser, and the schema that says what that half is.
 *
 * It is the mirror of `src/server/env.ts` and differs from it in the one way
 * that is the reason there are two files: this one is **not** `server-only`, so
 * a Client Component may import it. That is what makes the boundary structural
 * rather than a convention — a component reaching for `DATABASE_URL` fails the
 * build, and a component reaching for a public value does not have to ask.
 *
 * ## Why the schema is here and not in `env-schema.mts`
 *
 * Because that module imports `access-code-cipher.mts`, in order to validate
 * `ACCESS_CODE_KEYS` at boot. Anything that imports it imports the cipher —
 * which is right on a server and wrong in a browser, and it is not hypothetical:
 * the first draft of this file took `publicEnvSchema` from there, and the
 * keyring parser plus the name of every server variable landed in the client
 * bundle. No value leaked, because only a `NEXT_PUBLIC_` variable is ever
 * inlined. But shipping the code that opens access codes to every browser is not
 * a thing to do by accident, and a bundler stops tree-shaking it the moment
 * somebody adds a side effect to that module.
 *
 * So the dependency rule is the boundary: **this file may import the parser and
 * `zod`, and nothing else from the environment contract.**
 *
 * ## Why the values are spelled out one by one
 *
 * `process.env` does not exist in a browser. What exists is whatever the
 * compiler inlined, and it inlines a `NEXT_PUBLIC_` variable only where the
 * property access is written **literally** — `process.env.NEXT_PUBLIC_SENTRY_DSN`
 * and nothing more indirect. Spreading `process.env`, or indexing it with a
 * variable, produces `undefined` in the bundle and the correct value on the
 * server: the worst possible failure, because it works everywhere it is tested
 * and is empty everywhere it matters.
 *
 * The literal list below is therefore not boilerplate to be tidied away with a
 * loop. It is the thing the compiler reads. A variable added to the schema
 * without a line there parses as absent, forever, silently.
 */
import { parseEnv } from "@/lib/env-parse.mts";
import { z } from "zod";

/**
 * The variables that are genuinely public, and are therefore allowed the prefix
 * that publishes them.
 *
 * A Sentry DSN is the honest first case. It is a write-only ingest endpoint — it
 * permits sending events and reading nothing — and every web application using
 * Sentry in a browser has one in its bundle by design. It is not a secret being
 * tolerated here; it is a value whose whole purpose is to be published.
 *
 * Nothing else belongs here by default. The test for admission is not "is this
 * low-risk" but **"would publishing it to every browser, permanently, be
 * correct"** — because the prefix does exactly that, and removing it later
 * un-publishes nothing.
 */
export const publicEnvSchema = z.object({
  /**
   * Where browser errors go (ADR-0013). Separate from `SENTRY_DSN` so that
   * server reporting and browser reporting are two switches; set both in
   * production, and neither anywhere else.
   */
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
});

type PublicEnv = z.infer<typeof publicEnvSchema>;

let parsed: PublicEnv | undefined;

/**
 * Every variable read literally, so the compiler can see it. See the note above
 * before adding one.
 */
function source(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  };
}

/**
 * The public configuration. Safe to call from a Client Component, and safe to
 * call from the server, which reads the same values.
 *
 * **It throws on a bad value, like the server's does** — and unlike the
 * server's, the caller has to decide whether that is survivable. A server that
 * refuses to start is a deploy the operator fixes before anybody sees it; a
 * browser that throws while loading is an outage caused by the typo, not
 * reported by it. `src/instrumentation-client.ts` is the caller that has to
 * care, and it says what it does about it.
 *
 * Parsed on first use and memoised, like `src/server/env.ts`, for the reason
 * that file gives about the build phase.
 */
export function publicEnv(): PublicEnv {
  parsed ??= parseEnv(publicEnvSchema, source());

  return parsed;
}
