/**
 * The application's validated environment. Import this rather than reaching for
 * `process.env`: the values here are checked, typed, and known to be present.
 *
 * Validation happens on module load, and `src/instrumentation.ts` imports it
 * before the server handles anything — so a missing or malformed variable is a
 * startup failure naming the variable, not a `TypeError` on the first query an
 * hour into a deploy. That ordering is the point of the file.
 *
 * `server-only` is what makes the split from `.env.example` structural. A Client
 * Component that imports this fails the build with a message saying so, which is
 * the behaviour worth having in a repository that goes public at v0.5: the other
 * outcome is `DATABASE_URL` compiling to `undefined` in the browser bundle and
 * the mistake surfacing as a confusing runtime error rather than as a wall.
 */
import "server-only";

import { parseEnv, serverEnvSchema } from "@/lib/env-schema.mts";

export const env = parseEnv(serverEnvSchema, process.env);
