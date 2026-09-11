/**
 * The application's validated environment. Call this rather than reaching for
 * `process.env`: the values it returns are checked, typed, and known to be
 * present.
 *
 * **Validated once, at boot, not at import.** `src/instrumentation.ts` calls
 * `verifyEnvironment()` before the server handles anything, so a missing or
 * malformed variable is still a startup failure naming the variable rather than
 * a `TypeError` on the first query an hour into a deploy. That ordering is the
 * point of the file and #20 is where it came from.
 *
 * It is a function rather than a `const` for one reason, and the reason is a
 * phase rather than a preference: `next build` imports every route and page
 * module to collect their configuration, and a module-scope parse would make the
 * build itself demand a `BETTER_AUTH_SECRET` and a Google client. The Dockerfile
 * builds with no environment at all — deliberately, because ADR-0006 keeps
 * configuration out of the build and ADR-0002 wants an image that is the same
 * artefact wherever it runs. An eager parse here would have quietly ended both.
 * The parse is memoised, so "once" is still literally true.
 *
 * `server-only` is what makes the split from `.env.example` structural. A Client
 * Component that imports this fails the build with a message saying so, which is
 * the behaviour worth having in a repository that goes public at v0.5: the other
 * outcome is `DATABASE_URL` compiling to `undefined` in the browser bundle and
 * the mistake surfacing as a confusing runtime error rather than as a wall.
 */
import "server-only";

import {
  parseEnv,
  serverEnvSchema,
  withPreviewAppUrl,
} from "@/lib/env-schema.mts";
import type { z } from "zod";

type ServerEnv = z.infer<typeof serverEnvSchema>;

let parsed: ServerEnv | undefined;

export function env(): ServerEnv {
  parsed ??= parseEnv(serverEnvSchema, withPreviewAppUrl(process.env));

  return parsed;
}
