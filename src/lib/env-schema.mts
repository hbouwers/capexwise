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
   * at boot, named in the failure. Preview deployments have generated hostnames
   * and so need it set per deployment, which is #32's job and is written down
   * in `.env.example` rather than papered over with a `VERCEL_URL` fallback
   * here — a fallback would make the wrong value a silent 302 to the wrong host.
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
});

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
 * There are no public variables today, and this is the note that says so rather
 * than an empty schema pretending to be one. When the first `NEXT_PUBLIC_`
 * variable arrives it gets a `publicEnvSchema` here and a `src/lib/env-public.ts`
 * that parses it — a separate module, importable from a Client Component, which
 * is the whole point of the split.
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
 * Thrown by `parseEnv`. A distinct class so a caller can tell a configuration
 * problem — which the operator fixes — from a bug, which the developer fixes.
 */
export class EnvironmentError extends Error {
  override readonly name = "EnvironmentError";
}

/**
 * The closing line of every failure. Deliberately not "copy `.env.example` to
 * `.env.local`" alone: the same message is printed by a container on Cloud Run,
 * where there is no `.env.local` to copy anything into and that advice sends the
 * reader looking for a file that should not exist. It names both homes and lets
 * the reader pick the one they are in.
 */
const DEFAULT_HINT =
  "Set it in the environment the process runs in — locally by copying " +
  "`.env.example` to `.env.local`, on a deploy through the platform's own " +
  "environment configuration. `.env.example` lists every variable, and the " +
  "README says where each value comes from in each environment.";

/**
 * An unset variable and one set to the empty string are the same thing, and the
 * distinction is not one anybody configures on purpose: GitHub Actions
 * substitutes an empty string for a secret that does not exist, and several
 * hosting dashboards will happily save a blank value. Without this, the empty
 * string reaches the schema as a present-but-invalid value and the error talks
 * about the format of something the operator never set.
 *
 * Whitespace is trimmed for the same reason — a trailing newline pasted into a
 * secrets UI is invisible in it.
 */
function normalise(
  source: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const normalised: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(source)) {
    const trimmed = value?.trim();
    normalised[key] = trimmed === "" ? undefined : trimmed;
  }

  return normalised;
}

/**
 * Formats the failure. **This never prints a value**, only variable names and
 * what is wrong with them, and that is a hard requirement rather than tidiness:
 * `DATABASE_URL` carries a password, this message is written to a deploy log,
 * and deploy logs are retained and widely readable. It is the same rule as the
 * migration runner's, which logs the host and database of the connection string
 * and never the string.
 */
function formatIssues(
  error: z.ZodError,
  source: Record<string, string | undefined>,
): string {
  const lines = error.issues.map((issue) => {
    const name = issue.path.join(".");
    const problem =
      source[name] === undefined
        ? "is not set"
        : `is invalid — it ${issue.message}`;

    return `  ${name} ${problem}`;
  });

  return lines.join("\n");
}

/**
 * Validates `source` against `schema`, returning the parsed values or throwing
 * an `EnvironmentError` that names every variable at fault at once. Reporting
 * them all together matters: fixing configuration one restart at a time is the
 * experience this is meant to replace.
 *
 * `hint` replaces the default closing line for callers whose fix is more
 * specific than "fill in `.env.local`".
 */
export function parseEnv<Schema extends z.ZodType>(
  schema: Schema,
  source: Record<string, string | undefined>,
  hint: string = DEFAULT_HINT,
): z.infer<Schema> {
  const normalised = normalise(source);
  const result = schema.safeParse(normalised);

  if (!result.success) {
    throw new EnvironmentError(
      `Invalid environment configuration:\n\n${formatIssues(result.error, normalised)}\n\n${hint}`,
    );
  }

  return result.data;
}
