/**
 * The environment parser: how a set of strings is checked against a schema, and
 * how a failure is reported. Framework-free, schema-free, and — the reason it is
 * its own file — **it imports nothing but `zod`**.
 *
 * It used to live in `src/lib/env-schema.mts`, next to the schemas it validates,
 * which is where it reads best. It was moved out when the first public variable
 * arrived, because that module imports `access-code-cipher.mts` in order to
 * validate `ACCESS_CODE_KEYS` — so anything importing the parser also imported
 * the cipher. That is harmless on a server and wrong in a browser:
 * `src/lib/env-public.ts` is importable from a Client Component by design, and
 * the chain put the whole server schema, the keyring parser and every server
 * variable's *name* into the client bundle. No value leaked — only a
 * `NEXT_PUBLIC_` variable is ever inlined — but shipping the code that opens
 * access codes to every browser is not a thing to do by accident, and it is a
 * thing bundlers stop tree-shaking the moment somebody adds a side effect.
 *
 * So the rule this file exists to keep is: **the parser may not import a
 * schema.** Schemas import it.
 */
import { z } from "zod";

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
