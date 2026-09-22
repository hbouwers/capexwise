/**
 * The environment contract: what the process needs, checked once, in one place.
 *
 * This module is deliberately framework-free and side-effect-free apart from the
 * prefix assertion at the bottom. It knows nothing about Next.js, `process.env`
 * or the filesystem, so both processes that need it can use it: the application
 * server and the migration runner. Each reads its own source of values and hands
 * it in. (`drizzle.config.ts` is the deliberate exception, and says why.)
 *
 * The module that actually reads `process.env` for the application is
 * `src/server/env.ts`, and it is `server-only`. This one is not, because the
 * migration runner is plain Node and `server-only` throws there.
 *
 * `.env.example` is the human-readable version of the schema below. A variable
 * added here without being added there is half a change.
 */
import { z } from "zod";

// Relative, with the extension, for the reason `src/db/migrate.mts` gives: the
// runner imports this file under plain Node, which resolves no `@/` alias.
import { AccessCodeCipherError, parseKeyring } from "./access-code-cipher.mts";

/**
 * The scheme, and that something follows it. Deliberately no more than that.
 *
 * It is worth this much because the common failures are an unset variable and a
 * value that is not a database at all — a `NEXT_PUBLIC_APP_URL` pasted into the
 * wrong line, say — and both produce a driver error deep in a query rather than
 * a startup error naming the variable.
 *
 * It is worth no more than that because the forms `pg` accepts are wider than
 * they look, and rejecting a valid one is a deploy this check has broken for no
 * reason. Cloud SQL from Cloud Run — ADR-0002's escape hatch, so not a
 * hypothetical — connects over a Unix socket as
 * `postgresql://user:pass@/db?host=/cloudsql/instance`, which WHATWG `URL`
 * throws on outright because the host is empty while credentials are present.
 * `pg` does not use `URL`; it uses `pg-connection-string`, which is a different
 * grammar. Reimplementing that here to be thorough would mean two parsers that
 * agree until the day they do not, and the one that would be wrong is this one.
 */
const postgresConnectionString = z.string().regex(/^postgres(ql)?:\/\/.+/, {
  message:
    "must be a Postgres connection string, like " +
    "postgresql://user:password@host:5432/database",
});

/**
 * Every variable the server reads, and nothing else. Adding one here makes it
 * required at boot for the whole application, which is the intent — a variable
 * that is genuinely optional gets `.optional()` and a documented fallback, not
 * an absence from this object.
 */
export const serverEnvSchema = z.object({
  DATABASE_URL: postgresConnectionString,

  /**
   * Where this deployment answers. Better Auth builds the OAuth callback from
   * it, and Google refuses a callback that is not on the redirect-URI list of
   * the client — so a wrong value here is a sign-in that fails at the provider
   * with a message about a URI mismatch rather than anything about us.
   *
   * Deliberately ours and required rather than Better Auth's own
   * `BETTER_AUTH_URL` picked up from the ambient environment: one name, checked
   * at boot, named in the failure. The one place it is derived rather than set
   * is a Vercel preview, whose hostname is generated per branch —
   * `withPreviewAppUrl` below, which says why that is safe there and nowhere
   * else.
   */
  APP_URL: z
    .string()
    .regex(/^https?:\/\/[^/]+$/, {
      message:
        "must be an origin with no trailing slash, like " +
        "http://localhost:3000 or https://capexwise.com",
    })
    .describe("The origin this deployment answers on."),

  /**
   * Signs session cookies and encrypts the OAuth tokens in `accounts`
   * (`account.encryptOAuthTokens`). Rotating it invalidates every session and
   * makes every stored provider token undecryptable, which is the correct
   * response to a leak and a bad surprise otherwise.
   *
   * 32 characters is Better Auth's own floor and is checked here so a short
   * value fails at boot rather than at the first sign-in. Length only — this
   * cannot tell a strong secret from `aaaa...`, and pretending otherwise would
   * be a check that reassures without protecting.
   */
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, { message: "must be at least 32 characters" }),

  /**
   * The Google OAuth client. Required, not optional: ADR-0004 makes Google the
   * only way to sign in during v0, so an instance without these is an
   * application nobody can enter. That is a startup failure naming the
   * variable, not a runtime discovery.
   */
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),

  /**
   * The keys that seal building access codes (ADR-0008): comma-separated
   * `<version>:<key>` entries. The highest version seals, and every version
   * listed can open. A rotation adds a version and removes the old one only
   * once nothing sealed under it remains.
   *
   * Checked here and parsed where it is used, by the same `parseKeyring`, so
   * the environment stays a record of strings and a malformed keyring stops the
   * server at boot rather than failing the first reveal. Required before any
   * table holds a code, so that the first building-facts deploy is not also
   * the first time every environment needs a new secret.
   *
   * Every environment has its own keyring. Production's is also kept outside
   * Vercel, because a Sensitive variable cannot be read back, and losing the
   * key means losing every code sealed under it.
   */
  ACCESS_CODE_KEYS: z.string().superRefine((value, ctx) => {
    try {
      parseKeyring(value);
    } catch (error) {
      if (!(error instanceof AccessCodeCipherError)) throw error;

      ctx.addIssue(error.message);
    }
  }),

  /**
   * The bearer token the nightly demo reset is called with (#34, ADR-0011).
   * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when the project
   * has this variable, and Cloud Scheduler can be told to send the same header,
   * so the route checks one thing wherever it runs.
   *
   * Optional, and absent means the reset is off: `/api/cron/demo-reset`
   * answers 404 to everybody. That is the right default for every environment
   * but the one that hosts the demo — locally and in CI there is nothing to
   * call it — and a route that is open because a secret was forgotten is the
   * failure this avoids. 32 characters for the reason `BETTER_AUTH_SECRET`
   * has them.
   */
  CRON_SECRET: z
    .string()
    .min(32, { message: "must be at least 32 characters" })
    .optional(),

  /**
   * Which Vercel environment this is. Vercel sets it on every deployment, and
   * nothing sets it anywhere else — locally, in CI and in the container it is
   * absent, which is why it is optional.
   *
   * Read for one thing: a preview cannot complete Google sign-in (#32), so the
   * sign-in page says so instead of sending the reader to Google's
   * `redirect_uri_mismatch`. Google matches redirect URIs exactly, and every
   * preview branch has a new hostname to match.
   */
  VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),

  /**
   * The commit this deployment was built from. Vercel sets it; nothing else
   * does, which is why it is optional.
   *
   * Two readers, and they want the same thing for the same reason (ADR-0013):
   * Sentry tags every error with it, so a regression names the deploy that
   * introduced it, and `/api/health` reports it, so the uptime check doubles as
   * a way to see what is actually running. Absent, both say so rather than
   * inventing a value — "unknown" is a true answer and a made-up sha is not.
   *
   * The Cloud Run escape hatch (ADR-0002) will need its own source for this,
   * since nothing outside Vercel sets it. That is a build argument in the
   * Dockerfile on the day it matters, not a variable to invent now.
   */
  VERCEL_GIT_COMMIT_SHA: z.string().optional(),

  /**
   * Where server-side errors go (ADR-0013). Optional, and absent means error
   * tracking is off — which is the right default on a laptop and on a preview.
   *
   * A preview reporting into the same Sentry project as production makes the
   * production feed useless inside a week: every half-finished branch arrives
   * in the same stream as the errors real people hit. So this is set in
   * Vercel's Production scope and nowhere else, rather than being set once for
   * the project.
   *
   * Not a secret in the way `BETTER_AUTH_SECRET` is — a DSN only permits
   * writing events — but it is kept off the client half of this file anyway.
   * The browser gets its own, `NEXT_PUBLIC_SENTRY_DSN`, so that turning
   * reporting on in one place and not the other is a thing somebody can
   * actually do.
   */
  SENTRY_DSN: z.string().url().optional(),

  /**
   * The PostHog project key, and the host its instance answers on (ADR-0013).
   * Optional, and absent means no analytics — the same default as Sentry, for
   * the same reason: a preview branch's clicks are not a funnel.
   *
   * There is no `NEXT_PUBLIC_` twin, and that absence is the decision rather
   * than an omission. ADR-0013 keeps analytics server-side entirely: no browser
   * script, no autocapture, no session replay, no cookie. Adding a public key
   * here is what would make the browser half possible, so it is not here.
   *
   * The host is optional with a fallback rather than a `.default()`, which is
   * the rule this schema states for itself at the top: a default would make it
   * a key present in every parsed environment, including the ones that have
   * never heard of PostHog. The fallback is PostHog's US cloud and lives in
   * `src/server/analytics.ts`, next to the client it configures.
   *
   * It is worth setting deliberately. An EU project answers on
   * `eu.i.posthog.com`, and a key sent to the wrong one of the two simply
   * fails — at the vendor, silently, which is the failure mode analytics is
   * worst at revealing.
   */
  POSTHOG_KEY: z.string().min(1).optional(),
  POSTHOG_HOST: z.string().url().optional(),
});

/**
 * The public schema is **not** here, and its absence is the decision.
 *
 * It lives in `src/lib/env-public.ts`, together with the module that parses it,
 * because that module is importable from a Client Component and this one is not
 * safe to be: validating `ACCESS_CODE_KEYS` above means importing
 * `access-code-cipher.mts`, so a browser that reached this file would receive
 * the keyring parser and the name of every server variable in its bundle.
 *
 * So the two halves are separated by what may import them rather than by a
 * comment asking nicely. The rule for what may go in the public one is stated
 * there, and the assertion at the foot of this file is what keeps this one from
 * drifting into it.
 */

/**
 * Fills in `APP_URL` on a Vercel preview deployment, and nowhere else.
 *
 * A preview's hostname is generated per git branch, so there is no value to set
 * once in the project's Preview scope, and Vercel does not interpolate one
 * variable into another. `VERCEL_BRANCH_URL` is that branch's own hostname —
 * the one the pull request links to — and Vercel sets it on every deployment
 * made from git. On a preview, then, the derived value is the right one by
 * construction rather than a guess.
 *
 * Anywhere else a fallback would be exactly the failure the schema exists to
 * prevent. Production, the container and a laptop each answer on an origin only
 * the operator knows, and deriving one there would turn a missing value into a
 * silent redirect to the wrong host. So it is scoped to `VERCEL_ENV=preview`,
 * and an `APP_URL` that is set always wins.
 *
 * It reads `VERCEL_BRANCH_URL` from the source and adds nothing to the parsed
 * environment: the hostname is an input to `APP_URL`, not a value anything else
 * should be reading.
 */
export function withPreviewAppUrl(
  source: Record<string, string | undefined>,
): Record<string, string | undefined> {
  if (source.VERCEL_ENV?.trim() !== "preview") return source;
  if (source.APP_URL?.trim()) return source;

  const host = source.VERCEL_BRANCH_URL?.trim();
  if (!host) return source;

  return { ...source, APP_URL: `https://${host}` };
}

/**
 * What `npm run db:migrate` needs, which is a strict subset. The runner does not
 * get `serverEnvSchema`: it runs in CI on a push to `main` (ADR-0006) in a job
 * that has a database and no reason to hold an auth secret or a Stripe key, and
 * validating the full server schema there would make every variable the
 * application ever grows a prerequisite for applying a migration.
 */
export const migrationEnvSchema = serverEnvSchema.pick({ DATABASE_URL: true });

/**
 * The integration suite's database, which is deliberately not `DATABASE_URL`.
 *
 * It is a separate variable rather than a reuse of the server's because the two
 * mean opposite things: one names a database to preserve, the other names one
 * the suite truncates before every test. Sharing a name would make a mistake in
 * either direction silent, and the mistake in one of those directions is losing
 * a developer's local data. `src/test/db.ts` additionally refuses any value that
 * does not name a database ending in `_test`.
 *
 * It is not in `serverEnvSchema` because the server never reads it — putting it
 * there would make a test-only variable a prerequisite for booting production.
 * The suite supplies its own local default, so this schema is what validates an
 * override rather than what demands a value.
 */
export const testEnvSchema = z.object({
  TEST_DATABASE_URL: postgresConnectionString,
});

/**
 * What `npm run db:backup` needs: the database to back up, and a scratch one to
 * restore the result into (#35, ADR-0010).
 *
 * Two variables rather than a reuse of `DATABASE_URL`, for the reason
 * `TEST_DATABASE_URL` is separate: one names a database to preserve and the
 * other names one the command drops and recreates on every run.
 * `src/db/backup.mts` additionally refuses a restore target whose name does not
 * end in `_restore`. Neither is in `serverEnvSchema`, because the server never
 * reads them.
 */
export const backupEnvSchema = z.object({
  BACKUP_SOURCE_URL: postgresConnectionString,
  BACKUP_RESTORE_URL: postgresConnectionString,
});

/**
 * The server schema may not carry the prefix that publishes a value.
 * `publicEnvSchema`, in `src/lib/env-public.ts`, is where a variable goes when
 * it should be published — a separate module, importable from a Client
 * Component, which is the whole point of the split.
 *
 * The split is enforced from this side too. `NEXT_PUBLIC_` is not a naming
 * convention: the compiler inlines any variable carrying that prefix into the
 * client bundle as a literal, so a secret that acquires one is published to every
 * browser and stays published in every cached build. The assertion below makes
 * that specific mistake a startup failure instead of an incident. It runs on
 * module load rather than inside `parseEnv` because it is a property of the
 * schema, not of any particular set of values — it should fail on a developer's
 * machine the moment the key is typed, whatever the environment holds.
 */
const PUBLIC_PREFIX = "NEXT_PUBLIC_";

for (const key of Object.keys(serverEnvSchema.shape)) {
  if (key.startsWith(PUBLIC_PREFIX)) {
    throw new Error(
      `\`${key}\` is in the server environment schema but carries the ` +
        `${PUBLIC_PREFIX} prefix, which inlines its value into the client ` +
        `bundle. Drop the prefix, or move it to the public schema if it is ` +
        `genuinely not a secret.`,
    );
  }
}

/**
 * The parser and its error class now live in `src/lib/env-parse.mts`, and are
 * re-exported here so that every existing caller still imports them from the
 * environment contract.
 *
 * They moved when the first `NEXT_PUBLIC_` variable arrived. `src/lib/env-public.ts`
 * is importable from a Client Component by design, and it needs `parseEnv` — so
 * while the parser lived in this file, importing it also imported this file's
 * `access-code-cipher.mts` dependency, and the bundler put the keyring parser
 * and every server variable's name into the client bundle. That file says the
 * rest.
 */
export { EnvironmentError, parseEnv } from "./env-parse.mts";
