/**
 * Everything the server checks before it serves anything. `src/instrumentation.ts`
 * calls it; this file exists separately from that one because of the runtime
 * split described there.
 */
import "server-only";

import { EnvironmentError } from "@/lib/env-schema.mts";

export async function verifyEnvironment(): Promise<void> {
  try {
    // Calling it is what validates it, and this is the call that makes "checked
    // at boot" true — `@/server/env` parses on first use rather than on import,
    // for the build-phase reason that file gives. Nothing else in the
    // application is guaranteed to run before the first request, which is why
    // the check lives in the instrumentation hook and not in a module somebody
    // happens to import early.
    const { env } = await import("@/server/env");

    env();
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
