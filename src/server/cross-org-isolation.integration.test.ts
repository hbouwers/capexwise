/**
 * The cross-org isolation test: one file, extended per table for as long as the
 * product has tables. ADR-0003 names it as the check on the tenancy boundary
 * that does not depend on anybody remembering to write one, and the PR template
 * carries the line that keeps it growing.
 *
 * ## What it proves, and through which paths
 *
 * The claim is that a person acting in org A can neither see nor change org B's
 * rows *through the paths the product actually exposes*. Which paths those are
 * changes as the product is built, so today's list is worth stating:
 *
 * - **Better Auth's organization endpoints**, `/api/auth/organization/*`. They
 *   are live and public, and they are the only code in the product that accepts
 *   an org id from the client — in the query string or the body, because that is
 *   the library's API. ADR-0003's rule is that a client-supplied org id is
 *   ignored; these validate it against `memberships` instead, and
 *   `src/server/auth.ts` accepts that on the grounds that they scope by the
 *   caller's membership. This file is what checks that they do, and it runs
 *   again every time the exact-version pin on `better-auth` moves.
 * - **`getOrgContext()`**, where every domain query will start. It takes no
 *   arguments, so a route param or a body cannot reach it by construction; what
 *   can is the request's headers and the session they carry.
 *
 * What is *not* here is the case ADR-0003 worries about most: a domain query
 * that forgot its `org_id` filter. No domain table exists yet, and until #28's
 * policies do, nothing would stop that query — `src/server/org-context.ts` says
 * so plainly. #28 adds that case here, over every table in `ORG_OWNED`, by
 * running unfiltered reads and writes through `forOrg()` and asserting B's rows
 * stay out of reach.
 *
 * ## How a probe is judged
 *
 * Every probe runs twice, as org A's owner — the most privileged role there is,
 * so a refusal is about the org and never about the role:
 *
 * 1. **Against A**, where it must succeed. This is the control, and it is not
 *    optional: a request refused because its URL is wrong, its body fails
 *    validation or its origin fails the CSRF check looks exactly like a request
 *    refused for crossing orgs. A probe that cannot succeed at home proves
 *    nothing abroad.
 * 2. **Against B**, where it must be refused, and refused as a non-member
 *    rather than for some unrelated reason — `REFUSED` says which statuses
 *    count.
 *
 * After both, every one of B's rows in every `ORG_OWNED` table — read through the
 * harness's unscoped connection, which is what `src/test/db.ts` holds it for —
 * must be exactly what it was, and the response must carry none of B's
 * identifiers. The home run is held to both rules as well: an update to A that
 * found its rows by name rather than by id would rename B too.
 *
 * ## Why the two orgs look alike
 *
 * Same name, same shape, one person who belongs to both, and a pending
 * invitation to the same address in each. A lookup keyed on anything but the org
 * — a name, an email — then finds a row on both sides, and the snapshot sees it
 * touch the wrong one. It is also why every assertion here is about ids: a name
 * cannot tell the two orgs apart, which is the point.
 *
 * ## Adding a table
 *
 * 1. Name it in `ORG_OWNED`, with the column that says which org a row belongs
 *    to, or in `OUTSIDE_THE_BOUNDARY` with the reason it has none. The first test
 *    fails until one of them does.
 * 2. Seed a row on each side in `seedTwoOrgs()`. The third test fails until both
 *    sides have one.
 * 3. Add a probe for each path that reads or writes it — a query in
 *    `src/server/queries/`, an action in `src/server/actions/`.
 */
import { makeSignature } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { sessions } from "@/db/schema";
import { applicationDatabaseUrl, testDb } from "@/test/db";
import {
  createInvitation,
  createMembership,
  createOrganization,
  createUser,
} from "@/test/factories";

/**
 * What `headers()` hands `getOrgContext()`. Next.js supplies it from the request
 * in production; here the test sets it, and that is the only part of the path
 * that is not the real one. The session it points at is real and the cookie is
 * signed with the provider's own secret — see `signIn()`.
 */
const request = vi.hoisted(() => ({ headers: new Headers() }));

vi.mock("next/headers", () => ({
  headers: async () => request.headers,
}));

const APP_URL = "http://localhost:3000";

process.env.DATABASE_URL = applicationDatabaseUrl;
process.env.APP_URL = APP_URL;
process.env.BETTER_AUTH_SECRET = "integration-suite-secret-not-a-real-one";
process.env.GOOGLE_CLIENT_ID = "integration-suite-client-id";
process.env.GOOGLE_CLIENT_SECRET = "integration-suite-client-secret";

// Dynamic, and after the assignments above: a static import is hoisted, and the
// pool would be built from `.env.local` before the first line of this file ran.
const { getAuth } = await import("@/server/auth");
const { getOrgContext } = await import("@/server/org-context");

/**
 * Every table that holds an org's data, and the column that says which org a
 * row belongs to. One line per table.
 *
 * `organizations` is keyed on `id` because it is the boundary rather than a
 * table inside it — `docs/data-model.md` §2 gives it an `id = current_org_id`
 * policy for the same reason.
 */
const ORG_OWNED = {
  organizations: "id",
  memberships: "org_id",
  invitations: "org_id",
} as const satisfies Record<string, string>;

/**
 * Every table with no org, by name, and why. Written down rather than left out,
 * so that a reader finds a decision instead of an omission — which is what
 * `docs/data-model.md` §5 asks for `capital_item_types` when it arrives.
 */
const OUTSIDE_THE_BOUNDARY: Record<string, string> = {
  users:
    "Identity sits above the boundary: one account, any number of orgs (data-model §2).",
  sessions:
    "Read during sign-in, before an org exists to scope by. Its active_org_id is only a hint, and getOrgContext() is tested below for treating it as one.",
  accounts: "A user's OAuth links, not an org's (data-model §2).",
  verifications:
    "Single-use provider tokens, written before anyone is identified (data-model §2).",
  rate_limits:
    "Counters keyed by IP address and path, taken before anyone is identified (data-model §2).",
};

/**
 * The only org-owned tables the identity path may read without an org context,
 * and why each is on the list. ADR-0007 is the decision; the registry test below
 * is what keeps the list from growing by accident.
 *
 * These are the tables that *establish* the boundary rather than sit inside it:
 * deciding which org a session may act in means reading memberships before any
 * of them is the context. A domain table never belongs here — a policy that
 * admits the identity path to `buildings` would be a way to read every tenant's
 * buildings with no org at all.
 */
const IDENTITY_PATH: Partial<Record<keyof typeof ORG_OWNED, string>> = {
  organizations:
    "Created at sign-in, before the account has an org, and read to resolve one.",
  memberships:
    "The join in resolveOrgForUser() that decides which org a session may act in.",
  invitations:
    "Better Auth's organization endpoints, which scope by the caller's membership and are probed below.",
};

/** The two database roles the migrations create — see `drizzle/0006`. */
const SCOPED_ROLE = "capexwise_scoped";
const IDENTITY_ROLE = "capexwise_identity";

/**
 * Every table in the schema that `role` holds any privilege on at all. A table
 * a role cannot touch is `permission denied` for it, so this is the set of
 * tables where a policy — or the lack of one — decides what it sees.
 */
async function tablesReachableBy(role: string): Promise<string[]> {
  // By oid rather than by name: the planner is free to evaluate the privilege
  // check before the schema filter, and a name built from another schema's
  // table does not resolve in `public`.
  const { rows } = await testDb().execute<{ relname: string }>(sql`
    select relname from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r'
      and has_table_privilege(${role}::name, oid, 'select, insert, update, delete')
    order by relname
  `);

  return rows.map((row) => row.relname);
}

/** The `using` and `with check` of every policy that names `role`, by table. */
async function policiesFor(
  role: string,
): Promise<Record<string, { cmd: string; qual: string; withCheck: string }>> {
  const { rows } = await testDb().execute<{
    tablename: string;
    cmd: string;
    qual: string;
    with_check: string;
  }>(sql`
    select tablename, cmd, qual, with_check from pg_policies
    where schemaname = 'public' and ${role} = any (roles)
  `);

  return Object.fromEntries(
    rows.map((row) => [
      row.tablename,
      { cmd: row.cmd, qual: row.qual, withCheck: row.with_check },
    ]),
  );
}

/**
 * Every row an org owns, in every `ORG_OWNED` table, through the harness's own
 * connection — the one that can see what a scoped path hides, so that "the
 * probe could not reach it" is never confused with "it was never there".
 *
 * Ordered by the whole row cast to text rather than by `id`, because not every
 * table will have one: `contact_tags` is keyed on `(contact_id, tag)`.
 */
async function rowsOwnedBy(orgId: string): Promise<Record<string, unknown[]>> {
  const owned: Record<string, unknown[]> = {};

  for (const [table, column] of Object.entries(ORG_OWNED)) {
    const { rows } = await testDb().execute(
      sql`select * from ${sql.identifier(table)}
          where ${sql.identifier(column)} = ${orgId}
          order by ${sql.identifier(table)}::text`,
    );

    owned[table] = rows;
  }

  return owned;
}

/** Two orgs, as alike as the schema allows. The module comment says why. */
async function seedTwoOrgs() {
  const shared = await createUser({ name: "Jordan Reyes" });

  async function side() {
    const org = await createOrganization({ name: "Maple Street Holdings" });
    const owner = await createUser({ name: "Sam Okafor" });
    const member = await createUser({ name: "Alex Chen" });

    const ownerMembership = await createMembership(org.id, owner.id, {
      role: "owner",
    });
    const memberMembership = await createMembership(org.id, member.id);
    const sharedMembership = await createMembership(org.id, shared.id);

    const invitation = await createInvitation(org.id, owner.id, {
      email: "new-hire@example.test",
    });

    return {
      org,
      owner,
      member,
      ownerMembership,
      memberMembership,
      sharedMembership,
      invitation,
    };
  }

  const a = await side();
  const b = await side();

  return { a, b, shared };
}

type World = Awaited<ReturnType<typeof seedTwoOrgs>>;
type Side = World["a"];

/**
 * Everything that would identify one of B's rows if it turned up in a response
 * to A. Two things are left out because they are legitimately visible from A:
 * the shared person's id and email — they are A's member too — and the invited
 * address, which is the same on both sides by design.
 */
function identifiersOf(side: Side): string[] {
  return [
    side.org.id,
    side.org.slug,
    side.owner.id,
    side.owner.email,
    side.member.id,
    side.member.email,
    side.ownerMembership.id,
    side.memberMembership.id,
    side.sharedMembership.id,
    side.invitation.id,
  ];
}

type Caller = { sessionId: string; cookie: string };

/**
 * Signs somebody in the way the provider does once Google hands them back: a
 * `sessions` row written through Better Auth's own adapter — so the hook in
 * `src/server/auth.ts` that chooses their active org runs — and a cookie holding
 * the session token signed with the provider's secret.
 *
 * Better Auth's `testUtils` plugin builds its cookie exactly this way. It is
 * reproduced rather than installed because installing it means adding it to the
 * production configuration. Nothing here is forged: the session is real, and
 * the signature is the one the provider would have set.
 */
async function signIn(userId: string): Promise<Caller> {
  const context = await getAuth().$context;
  const session = await context.internalAdapter.createSession(userId, false);
  const signature = await makeSignature(session.token, context.secret);

  return {
    sessionId: session.id,
    cookie: `${context.authCookies.sessionToken.name}=${session.token}.${signature}`,
  };
}

async function activeOrgOf(sessionId: string): Promise<string | null> {
  const [row] = await testDb()
    .select({ activeOrgId: sessions.activeOrgId })
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  return row?.activeOrgId ?? null;
}

/**
 * What a probe reports: the status, and everything it said back, so the test can
 * look for B's identifiers in it.
 */
type Outcome = { status: number; body: string };

/**
 * The two statuses Better Auth refuses a non-member with — it uses both, and
 * which one depends on the endpoint. Any other failure is not a refusal: a 401
 * means the caller was never signed in, a 404 that the route is gone, a 429 that
 * the rate limit bit, and a 500 that something broke. Each of those would make
 * "refused" true for a reason that has nothing to do with orgs.
 */
const REFUSED = [400, 403];

/**
 * A request to the provider's handler — what `src/app/api/auth/[...all]/route.ts`
 * passes every request on to. `origin` is set because Better Auth refuses a
 * cookie-bearing POST from anywhere but a trusted origin; without it every write
 * probe would fail the CSRF check, and the control runs are what would say so.
 */
async function call(
  caller: Caller,
  method: "GET" | "POST",
  path: string,
  params: Record<string, unknown>,
): Promise<Outcome> {
  const url = new URL(`/api/auth${path}`, APP_URL);

  if (method === "GET") {
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(name, String(value));
    }
  }

  const response = await getAuth().handler(
    new Request(url, {
      method,
      headers: {
        cookie: caller.cookie,
        origin: APP_URL,
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.27",
      },
      body: method === "POST" ? JSON.stringify(params) : undefined,
    }),
  );

  return { status: response.status, body: await response.text() };
}

type Probe = {
  /** The table whose rows the path reads or writes. */
  table: keyof typeof ORG_OWNED;
  /** What the owner of A attempts, as the test name reads. */
  attempt: string;
  run: (caller: Caller, target: Side, world: World) => Promise<Outcome>;
};

/**
 * Every path that reads or writes an org-owned row and takes an org, or a row
 * belonging to one, from the client.
 *
 * "Alone" means the request names B's row but no org, so the endpoint falls
 * back to the caller's active one — the case where a row id from one org is
 * checked against another org's permissions.
 *
 * Organization endpoints left out, and why:
 *
 * - `create` is switched off (`allowUserToCreateOrganization: false`), and
 *   `add-member` is server-only — neither is routed.
 * - `get-invitation`, `accept-invitation`, `reject-invitation` and
 *   `list-user-invitations` are keyed on the caller's email, not on an org, so
 *   there is no home run that could succeed for them.
 * - `leave` and `list` act only on the caller's own memberships.
 * - `check-slug` answers whether a slug is taken, across every org, which is
 *   what a globally unique slug means. The random suffix `src/server/auth.ts`
 *   adds keeps it from being a way to enumerate orgs.
 */
const PROBES: Probe[] = [
  {
    table: "organizations",
    attempt: "read the org by id",
    run: (caller, target) =>
      call(caller, "GET", "/organization/get-full-organization", {
        organizationId: target.org.id,
      }),
  },
  {
    table: "organizations",
    attempt: "read the org by slug",
    run: (caller, target) =>
      call(caller, "GET", "/organization/get-full-organization", {
        organizationSlug: target.org.slug,
      }),
  },
  {
    table: "organizations",
    attempt: "read the org's summary",
    run: (caller, target) =>
      call(caller, "GET", "/organization/get-organization", {
        organizationId: target.org.id,
      }),
  },
  {
    table: "organizations",
    attempt: "rename the org",
    run: (caller, target) =>
      call(caller, "POST", "/organization/update", {
        organizationId: target.org.id,
        data: { name: "Renamed Holdings" },
      }),
  },
  {
    table: "organizations",
    attempt: "delete the org",
    run: (caller, target) =>
      call(caller, "POST", "/organization/delete", {
        organizationId: target.org.id,
      }),
  },
  {
    table: "organizations",
    attempt: "switch the session into the org",
    run: (caller, target) =>
      call(caller, "POST", "/organization/set-active", {
        organizationId: target.org.id,
      }),
  },
  {
    table: "memberships",
    attempt: "list the members",
    run: (caller, target) =>
      call(caller, "GET", "/organization/list-members", {
        organizationId: target.org.id,
      }),
  },
  {
    table: "memberships",
    attempt: "read a member's role",
    run: (caller, target) =>
      call(caller, "GET", "/organization/get-active-member-role", {
        organizationId: target.org.id,
        userId: target.member.id,
      }),
  },
  {
    table: "memberships",
    attempt: "promote a member to owner",
    run: (caller, target) =>
      call(caller, "POST", "/organization/update-member-role", {
        organizationId: target.org.id,
        memberId: target.memberMembership.id,
        role: "owner",
      }),
  },
  {
    table: "memberships",
    attempt: "promote a member to owner, by member id alone",
    run: (caller, target) =>
      call(caller, "POST", "/organization/update-member-role", {
        memberId: target.memberMembership.id,
        role: "owner",
      }),
  },
  {
    table: "memberships",
    attempt: "remove a member",
    run: (caller, target) =>
      call(caller, "POST", "/organization/remove-member", {
        organizationId: target.org.id,
        memberIdOrEmail: target.memberMembership.id,
      }),
  },
  {
    table: "memberships",
    attempt: "remove a member, by member id alone",
    run: (caller, target) =>
      call(caller, "POST", "/organization/remove-member", {
        memberIdOrEmail: target.memberMembership.id,
      }),
  },
  {
    // The person in both orgs, named by email: an email lookup that was not
    // scoped to the org would find their membership on both sides, and the
    // home run would remove the wrong one.
    table: "memberships",
    attempt: "remove a member who is in both orgs, by email",
    run: (caller, target, world) =>
      call(caller, "POST", "/organization/remove-member", {
        organizationId: target.org.id,
        memberIdOrEmail: world.shared.email,
      }),
  },
  {
    table: "invitations",
    attempt: "list the invitations",
    run: (caller, target) =>
      call(caller, "GET", "/organization/list-invitations", {
        organizationId: target.org.id,
      }),
  },
  {
    table: "invitations",
    attempt: "invite somebody into the org",
    run: (caller, target) =>
      call(caller, "POST", "/organization/invite-member", {
        organizationId: target.org.id,
        email: "another-hire@example.test",
        role: "member",
      }),
  },
  {
    // No org in the body at all: the endpoint takes it from the invitation.
    table: "invitations",
    attempt: "cancel an invitation",
    run: (caller, target) =>
      call(caller, "POST", "/organization/cancel-invitation", {
        invitationId: target.invitation.id,
      }),
  },
];

describe("the registry", () => {
  it("names every table in the schema exactly once", async () => {
    const { rows } = await testDb().execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );

    const inSchema = rows.map((row) => row.tablename);
    const owned = Object.keys(ORG_OWNED);
    const exempt = Object.keys(OUTSIDE_THE_BOUNDARY);

    expect(
      inSchema.filter(
        (table) => !owned.includes(table) && !exempt.includes(table),
      ),
      "These tables are in the schema and not in this file. Add each to " +
        "ORG_OWNED with the column that says which org owns a row, or to " +
        "OUTSIDE_THE_BOUNDARY with the reason it has none.",
    ).toEqual([]);

    expect(
      [...owned, ...exempt].filter((table) => !inSchema.includes(table)),
      "These tables are named here and no longer exist.",
    ).toEqual([]);

    expect(
      owned.filter((table) => exempt.includes(table)),
      "These tables are both org-owned and exempt, which cannot be true.",
    ).toEqual([]);
  });

  it("keys every org-owned table on a required reference to organizations", async () => {
    // The column the snapshot filters on has to be one no row can escape: a
    // nullable `org_id` is a row no org owns and no probe is judged against,
    // and an `org_id` that references nothing names an org that may not exist.
    const { rows } = await testDb().execute<{ reference: string }>(sql`
      select c.conrelid::regclass::text || '.' || a.attname as reference
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.contype = 'f'
        and c.confrelid = 'organizations'::regclass
        and a.attnotnull
    `);

    const references = rows.map((row) => row.reference);

    expect(
      Object.entries(ORG_OWNED)
        .filter(([table]) => table !== "organizations")
        .map(([table, column]) => `${table}.${column}`)
        .filter((reference) => !references.includes(reference)),
      "These columns are not `not null references organizations (id)`, which " +
        "is item 1 of the per-table checklist in docs/data-model.md §9.",
    ).toEqual([]);
  });

  it("enables and forces row-level security on every org-owned table", async () => {
    // Forced as well as enabled, and the second is the one that gets
    // forgotten: without it the table's owner is exempt from its own policies,
    // and the owner is exactly the role a Neon login is.
    const { rows } = await testDb().execute<{
      table: string;
      enabled: boolean;
      forced: boolean;
    }>(sql`
      select relname as table, relrowsecurity as enabled,
             relforcerowsecurity as forced
      from pg_class
      where relnamespace = 'public'::regnamespace and relkind = 'r'
    `);

    const unprotected = Object.keys(ORG_OWNED).filter((table) => {
      const row = rows.find((candidate) => candidate.table === table);
      return !row?.enabled || !row.forced;
    });

    expect(
      unprotected,
      "These org-owned tables are missing `enable row level security` or " +
        "`force row level security` — item 3 of the per-table checklist in " +
        "docs/data-model.md §9.",
    ).toEqual([]);
  });

  it("gives the scoped role a policy on every org-owned table, keyed on its org column", async () => {
    // Asserted against the policy's text rather than merely its existence: a
    // policy of `using (true)` exists, is enabled, and isolates nothing. Both
    // halves, because `using` alone stops B's rows being read while still
    // letting a scoped handle write one.
    const policies = await policiesFor(SCOPED_ROLE);

    for (const [table, column] of Object.entries(ORG_OWNED)) {
      const expected = `(${column} = current_org_id())`;

      expect(
        policies[table],
        `${table} has no policy for ${SCOPED_ROLE} keyed on ${column} — ` +
          "the template is in docs/data-model.md §9.",
      ).toEqual({ cmd: "ALL", qual: expected, withCheck: expected });
    }
  });

  it("gives the scoped role nothing on a table without a policy for it", async () => {
    // The general form of the rule, rather than a list of tables to check: a
    // grant with no policy behind it is every org's rows, so any table the
    // scoped role can touch must be one the test above has already vetted. A
    // table outside the boundary that the scoped role could read is the leak.
    const reachable = await tablesReachableBy(SCOPED_ROLE);
    const policed = Object.keys(await policiesFor(SCOPED_ROLE));

    expect(
      reachable.filter((table) => !policed.includes(table)),
      `${SCOPED_ROLE} holds privileges on these tables and no policy limits ` +
        "which rows it sees.",
    ).toEqual([]);
  });

  it("confines the identity path to the tables that establish the boundary", async () => {
    // ADR-0007's narrow bypass, held to its word. The identity path reads every
    // row of the tables in IDENTITY_PATH, which is how sign-in works at all; it
    // must hold no policy anywhere else, and no privilege on anything inside
    // the boundary beyond them. A domain table the identity role could read is
    // a table the unscoped client could read without an org.
    expect(Object.keys(await policiesFor(IDENTITY_ROLE)).sort()).toEqual(
      Object.keys(IDENTITY_PATH).sort(),
    );

    expect(
      (await tablesReachableBy(IDENTITY_ROLE)).filter(
        (table) =>
          !Object.hasOwn(OUTSIDE_THE_BOUNDARY, table) &&
          !Object.hasOwn(IDENTITY_PATH, table),
      ),
      `${IDENTITY_ROLE} holds privileges on these org-owned tables, which are ` +
        "not on the identity path.",
    ).toEqual([]);
  });

  it("lets neither role bypass row-level security", async () => {
    // Either attribute would make every policy above decorative. The migration
    // creates both roles without them; this is what notices if one is altered.
    const { rows } = await testDb().execute<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(sql`
      select rolname, rolsuper, rolbypassrls from pg_roles
      where rolname in (${SCOPED_ROLE}, ${IDENTITY_ROLE})
      order by rolname
    `);

    expect(rows).toEqual([
      { rolname: IDENTITY_ROLE, rolsuper: false, rolbypassrls: false },
      { rolname: SCOPED_ROLE, rolsuper: false, rolbypassrls: false },
    ]);
  });

  it("seeds every org-owned table on both sides", async () => {
    // Without a row on B's side, "B's rows are unchanged" is true of nothing
    // and every probe passes for that table without proving anything.
    const { a, b } = await seedTwoOrgs();

    for (const side of [a, b]) {
      const owned = await rowsOwnedBy(side.org.id);

      expect(
        Object.keys(owned).filter((table) => owned[table]?.length === 0),
        `seedTwoOrgs() writes nothing to these tables for ${side.org.slug}.`,
      ).toEqual([]);
    }
  });
});

describe.each(PROBES)("$table: $attempt", (probe) => {
  it("works in the caller's own org, and leaves the other org alone", async () => {
    const world = await seedTwoOrgs();
    const caller = await signIn(world.a.owner.id);
    const before = await rowsOwnedBy(world.b.org.id);

    const outcome = await probe.run(caller, world.a, world);

    expect(outcome.status, outcome.body).toBe(200);
    expect(
      identifiersOf(world.b).filter((id) => outcome.body.includes(id)),
    ).toEqual([]);
    expect(await rowsOwnedBy(world.b.org.id)).toEqual(before);
  });

  it("is refused against another org, and changes nothing there", async () => {
    const world = await seedTwoOrgs();
    const caller = await signIn(world.a.owner.id);
    const before = await rowsOwnedBy(world.b.org.id);

    const outcome = await probe.run(caller, world.b, world);

    expect(REFUSED, outcome.body).toContain(outcome.status);
    expect(
      identifiersOf(world.b).filter((id) => outcome.body.includes(id)),
    ).toEqual([]);
    expect(await rowsOwnedBy(world.b.org.id)).toEqual(before);
    // The session is the one row of the caller's that names an org. A refused
    // request must not have left it pointing at B either.
    expect(await activeOrgOf(caller.sessionId)).not.toBe(world.b.org.id);
  });
});

describe("getOrgContext", () => {
  it("resolves the caller's own org when the request names another everywhere it can", async () => {
    const { a, b } = await seedTwoOrgs();
    const caller = await signIn(a.owner.id);

    // The session itself pointed at B — what a tampered row, or a cookie cache
    // written before a membership was revoked, would carry.
    await testDb()
      .update(sessions)
      .set({ activeOrgId: b.org.id })
      .where(eq(sessions.id, caller.sessionId));

    // And B's id in every header a well-meaning change might one day read.
    // `getOrgContext()` takes no arguments, so a route param or a body cannot
    // reach it; headers are the rest of the request.
    request.headers = new Headers({
      cookie: caller.cookie,
      "x-org-id": b.org.id,
      "x-organization-id": b.org.id,
      "x-active-organization-id": b.org.id,
      referer: `${APP_URL}/?orgId=${b.org.id}`,
    });

    const context = await getOrgContext();

    expect(context.org.id).toBe(a.org.id);
    expect(context.db.orgId).toBe(a.org.id);
  });

  it("follows the session into an org the caller does belong to", async () => {
    // The control for the test above. Without it, an implementation that
    // ignored the session entirely and always picked the oldest membership
    // would pass that test, and #29's org switcher would silently do nothing.
    const { b, shared } = await seedTwoOrgs();
    const caller = await signIn(shared.id);

    await testDb()
      .update(sessions)
      .set({ activeOrgId: b.org.id })
      .where(eq(sessions.id, caller.sessionId));

    request.headers = new Headers({ cookie: caller.cookie });

    const context = await getOrgContext();

    expect(context.org.id).toBe(b.org.id);
    expect(context.db.orgId).toBe(b.org.id);
  });
});
