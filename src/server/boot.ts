/**
 * Everything the server checks before it serves anything. `src/instrumentation.ts`
 * calls it; this file exists separately from that one because of the runtime
 * split described there.
 */
import "server-only";

import { EnvironmentError } from "@/lib/env-schema.mts";

export async function verifyEnvironment(): Promise<void> {
  try {
    // Importing it is what validates it — see `src/server/env.ts`.
    await import("@/server/env");
  } catch (error) {
    if (!(error instanceof EnvironmentError)) throw error;

    // Exiting rather than rethrowing, for two reasons. Next installs its own
    // `unhandledRejection` listener, so an error thrown out of the
    // instrumentation hook is logged and then survived: the process keeps the
    // port bound and never serves, which reads to a supervisor as a healthy
    // container and to a developer as a hang. And a rethrow arrives wrapped in a
    // stack through the instrumentation loader, burying the one thing worth
    // reading. This is a configuration problem, and it has no stack worth
    // printing.
    console.error(`\n${error.message}\n`);
    process.exit(1);
  }
}
