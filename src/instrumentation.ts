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
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { verifyEnvironment } = await import("@/server/boot");

  await verifyEnvironment();
}
