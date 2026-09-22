/**
 * Next.js calls `register()` once when a server instance starts, before it
 * serves anything. That makes it the only hook in the framework where "fails at
 * boot" is literally true, which is why the environment check runs from here
 * (#20) rather than from a module that some request path happens to import
 * first.
 *
 * `next build` does not call this, and that is load-bearing rather than
 * incidental: the Dockerfile builds with no `DATABASE_URL` on purpose, because
 * ADR-0006 keeps the database out of the build. Configuration is a deploy-time
 * concern, so it is checked at deploy time.
 *
 * The work lives in `@/server/boot` and is reached by a dynamic import behind
 * the runtime check, which is the shape Next.js documents and not a stylistic
 * choice. This file is compiled for the Edge runtime as well as for Node, and
 * the compiler reads it statically: `server-only` and `process.exit` written
 * here are a build error and a build warning respectively, whatever the `if`
 * around them says. Behind the import they are never analysed for Edge at all.
 *
 * There is no Edge code in the application today. The guard is here so that
 * adding middleware later does not turn this file into a failure nobody expects.
 *
 * `@sentry/nextjs` is imported at the top of this file rather than behind the
 * guard, and that is safe where `server-only` is not: the SDK ships an Edge
 * build and `onRequestError` has to be a static export for Next.js to find it.
 * The *initialisation* still happens only under Node, below.
 */
import * as Sentry from "@sentry/nextjs";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { verifyEnvironment } = await import("@/server/boot");

  await verifyEnvironment();

  // After the environment check, never before it — `src/server/sentry.ts` says
  // why, and the reason is that `env()` parses on first use and the first parse
  // has to happen inside `verifyEnvironment()`'s `try`.
  const { initSentry } = await import("@/server/sentry");

  initSentry();
}

/**
 * Next.js calls this for every error thrown out of a Server Component, a route
 * handler or a server action. It is the hook that makes error tracking cover
 * the server at all: without it Sentry sees only what it can instrument
 * directly, and a React Server Component's render error is not that.
 *
 * Exported unconditionally. Where no DSN was configured, `Sentry.init()` never
 * ran and this does nothing.
 */
export const onRequestError = Sentry.captureRequestError;
