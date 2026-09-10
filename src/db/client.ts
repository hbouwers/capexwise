/**
 * The raw, unscoped database handle. **Almost nothing may import this**, and
 * `eslint.config.mjs` names the files that may — it is one of two rules in the
 * repository whose violation is a tenancy bug rather than a style complaint.
 *
 * The module the rest of the application uses is `@/server/org-context`, whose
 * `getOrgContext()` resolves the org from the session and returns a handle that
 * has already filtered by it (#26). Wanting to route around that is the signal
 * to fix its ergonomics, not to add a name to the allowlist.
 *
 * This file arrived with the auth provider (#25) rather than with #26, because
 * Better Auth needs a Drizzle instance to hand its adapter and there was nowhere
 * else for one to live. #26 wraps it; it does not replace it.
 *
 * **`src/server/auth.ts` is on the allowlist, and that is not a hole.** The four
 * tables Better Auth reads through this handle sit above the tenancy boundary by
 * construction — `docs/data-model.md` §2 — and are read during sign-in, before
 * any org exists to scope by. There is no org filter to omit there. The provider
 * also touches `organizations`, `memberships` and `invitations`, which do carry
 * `org_id`; what keeps that honest is that it reaches them only through the
 * organization plugin's own endpoints, which scope by the membership of the
 * signed-in user. That is a claim worth checking rather than assuming, and #27's
 * cross-org isolation test is where it gets checked.
 *
 * **This handle is the identity path, and row-level security treats it as one.**
 * It logs in as whatever `DATABASE_URL` names, and that role is a member of
 * `capexwise_identity` — which reads every row of `organizations`,
 * `memberships` and `invitations` and holds no grant on any table inside the
 * boundary. A scoped handle switches to `capexwise_scoped` on top of this pool
 * for each transaction; this handle, used bare, never does. ADR-0007 is the
 * decision. In production the login is `capexwise_app`, which is not the owner
 * and holds nothing else, so this handle gets `permission denied` on any domain
 * table there (#81). Locally it is the compose superuser, which reads anything,
 * and ESLint's allowlist is the only thing in the way.
 */
import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/db/schema";
import { env } from "@/server/env";

/**
 * One pool per process, and no configuration beyond the connection string.
 *
 * Sizing it is a deployment question, not a code question, and the deployment
 * does not exist yet: on Vercel every serverless instance opens its own pool and
 * the ceiling is the managed database's connection limit, which is what makes
 * #33 a separate piece of work with pgBouncer in it. A pool size guessed here
 * today would be a number nobody could justify and everybody would inherit.
 *
 * `node-postgres` rather than a serverless driver, deliberately: ADR-0002 keeps
 * Cloud Run as the escape hatch, and a driver that only speaks one vendor's HTTP
 * protocol is a dependency that has to come back out on the way there.
 *
 * Built on first use rather than on import, for the same reason `@/server/env`
 * parses on first use: `next build` imports every route module to collect its
 * configuration, and a pool constructed at module scope would make the build
 * demand a `DATABASE_URL`. It never connects here — `pg` opens a socket on the
 * first query — so this is about the *value* being required, not about reaching
 * a database.
 */
let open: { pool: Pool; db: NodePgDatabase<typeof schema> } | undefined;

export function db(): NodePgDatabase<typeof schema> {
  if (!open) {
    const pool = new Pool({ connectionString: env().DATABASE_URL });

    open = { pool, db: drizzle(pool, { schema }) };
  }

  return open.db;
}

export type Db = ReturnType<typeof db>;

/**
 * Closes the pool, if one was ever opened. A no-op otherwise.
 *
 * This exists for the integration suite. Vitest holds the process open on a live
 * socket and reports a hang rather than a failure — the same thing
 * `src/db/migrate.mts` guards against, and `src/test/db.ts` calls this alongside
 * closing its own connection. Nothing in the application calls it: a serverless
 * instance is torn down with its sockets, and a container gets SIGTERM.
 */
export async function closeDb(): Promise<void> {
  if (!open) return;

  const { pool } = open;
  open = undefined;

  await pool.end();
}
