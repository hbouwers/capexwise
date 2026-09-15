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
 * - **A domain query that forgot its `org_id` filter**, the case ADR-0003
 *   worries about most because correct and incorrect code look identical. The
 *   last block runs unfiltered reads, updates and deletes through a real scoped
 *   handle over every table in `ORG_OWNED`, and nothing in that SQL says which
 *   org it is for — so every one of B's rows it cannot reach is row-level
 *   security (#28) keeping it out. The registry checks the same layer from the
 *   catalog's side: every org-owned table forced, a scoped policy keyed on its
 *   org column, and neither application role reaching a table it should not.
 *   The backup's reader is the one role that crosses orgs by design, and the
 *   registry holds it to reading every row and writing none (ADR-0010).
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
 *    fails until one of them does, and the row-level security tests in the
 *    registry fail until an org-owned table is forced and has its policy —
 *    `docs/data-model.md` §9 has the template. The unfiltered-query block at the
 *    bottom then covers it without being told.
 * 2. Seed a row on each side in `seedTwoOrgs()`. The third test fails until both
 *    sides have one.
 * 3. Add a probe for each path that reads or writes it — a query in
 *    `src/server/queries/`, an action in `src/server/actions/`.
 */
import { makeSignature } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { contacts, organizations, sessions } from "@/db/schema";
import {
  buildingFactsFields,
  emptyAccessCodeFields,
  emptyUtilityFields,
} from "@/lib/building-facts-form";
import { buildingFields } from "@/lib/building-form";
import { contactFields } from "@/lib/contact-form";
import { applicationDatabaseUrl, REFERENCE_TABLES, testDb } from "@/test/db";
import {
  createAccessCode,
  createBuilding,
  createBuildingFacts,
  createContact,
  createInvitation,
  createMembership,
  createOrganization,
  createRentPeriod,
  createUnit,
  createUser,
  createUtility,
  tagContact,
  TEST_ACCESS_CODE_KEYS,
} from "@/test/factories";
import {
  FOREIGN_KEY_VIOLATION,
  INSUFFICIENT_PRIVILEGE,
  postgresErrorCode,
  rejectsWith,
  RESTRICT_VIOLATION,
} from "@/test/postgres-errors";

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

/**
 * `redirect()` ends a server action by throwing. Next.js catches the throw; here
 * nothing would, so it is replaced with one that says where it was going.
 */
const Redirect = vi.hoisted(
  () =>
    class Redirect extends Error {
      constructor(readonly url: string) {
        super(`redirect to ${url}`);
      }
    },
);

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));

const APP_URL = "http://localhost:3000";

process.env.DATABASE_URL = applicationDatabaseUrl;
process.env.APP_URL = APP_URL;
process.env.BETTER_AUTH_SECRET = "integration-suite-secret-not-a-real-one";
process.env.GOOGLE_CLIENT_ID = "integration-suite-client-id";
process.env.GOOGLE_CLIENT_SECRET = "integration-suite-client-secret";
// The key `createAccessCode` seals with, so a reveal here opens what it wrote.
process.env.ACCESS_CODE_KEYS = TEST_ACCESS_CODE_KEYS;

// Dynamic, and after the assignments above: a static import is hoisted, and the
// pool would be built from `.env.local` before the first line of this file ran.
const { getAuth } = await import("@/server/auth");
const { getOrgContext } = await import("@/server/org-context");
const { switchOrganization } = await import("@/server/actions/organizations");
// A namespace rather than names: `createBuilding` is also the factory's.
const buildingActions = await import("@/server/actions/buildings");
const { getBuilding, listBuildings } =
  await import("@/server/queries/buildings");
const contactActions = await import("@/server/actions/contacts");
const { getContact, listContacts, listTradeTags } =
  await import("@/server/queries/contacts");
const { revealAccessCode, saveBuildingFacts } =
  await import("@/server/actions/building-facts");
const { getBuildingFacts } = await import("@/server/queries/building-facts");

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
  buildings: "org_id",
  units: "org_id",
  contacts: "org_id",
  contact_tags: "org_id",
  building_facts: "org_id",
  building_utilities: "org_id",
  building_access_codes: "org_id",
  rent_periods: "org_id",
} as const satisfies Record<string, string>;

/**
 * Every table with no org, by name, and why. Written down rather than left out,
 * so that a reader finds a decision instead of an omission — which is what
 * `docs/data-model.md` §5 asks for `capital_item_types` when it arrives.
 *
 * The reference data among them is also on `REFERENCE_TABLES`, in the harness,
 * which the registry holds to being readable by the scoped role and writable
 * by nobody.
 */
const OUTSIDE_THE_BOUNDARY: Record<string, string> = {
  trade_tags:
    "Reference data: one trade list every org reads and only a migration writes (data-model §6).",
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

/**
 * The database roles the migrations create — see `drizzle/0006` for the first
 * two and `drizzle/0007` for the reader, which is the nightly backup's (#35).
 */
const SCOPED_ROLE = "capexwise_scoped";
const IDENTITY_ROLE = "capexwise_identity";
const READER_ROLE = "capexwise_reader";

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

type Policy = { cmd: string; qual: string | null; withCheck: string | null };

/**
 * Every permissive policy that applies to `role`, grouped by table.
 *
 * A list per table rather than one policy each, because permissive policies
 * are OR'd together: a second one on the same table widens what the first
 * allowed, so a check that kept only one of them could be passed by the
 * policy that isolates while the other one leaks. `public` counts as well as
 * the role itself — a policy `to public` applies to everybody. Restrictive
 * policies are left out; they can only narrow what the permissive ones allow.
 */
async function policiesFor(role: string): Promise<Record<string, Policy[]>> {
  const { rows } = await testDb().execute<{
    tablename: string;
    cmd: string;
    qual: string | null;
    with_check: string | null;
  }>(sql`
    select tablename, cmd, qual, with_check from pg_policies
    where schemaname = 'public'
      and permissive = 'PERMISSIVE'
      and (${role}::name = any (roles) or 'public' = any (roles))
    order by tablename, policyname
  `);

  const byTable: Record<string, Policy[]> = {};

  for (const row of rows) {
    (byTable[row.tablename] ??= []).push({
      cmd: row.cmd,
      qual: row.qual,
      withCheck: row.with_check,
    });
  }

  return byTable;
}

/**
 * Every row an org owns, in every `ORG_OWNED` table, through the harness's own
 * connection — the one that can see what a scoped path hides, so that "the
 * probe could not reach it" is never confused with "it was never there".
 *
 * Ordered by the whole row cast to text rather than by `id`, because not every
 * table has one: `contact_tags` is keyed on `(org_id, contact_id, tag)`, and
 * `building_facts` on its building.
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

    const building = await createBuilding(org.id, {
      addressLine1: "412 N Delaware St",
    });
    const unit = await createUnit(org.id, building.id, {
      label: "A",
      status: "occupied",
      rentCents: 230_000,
    });

    // The same plumber on both sides, by name and by phone, so a lookup keyed
    // on either finds one in each org.
    const contact = await createContact(org.id, {
      name: "Dana Whitfield",
      phone: "317-555-0142",
    });
    await tagContact(org.id, contact.id, "plumber");

    // The same facts on both sides: one trash day, one unit's electric
    // account with the plumber as its contact, and one front-door code with
    // the same digits — sealed for each org, so neither opens as the other's.
    await createBuildingFacts(org.id, building.id, { trashDay: "thu" });
    const utility = await createUtility(org.id, building.id, {
      unitId: unit.id,
      contactId: contact.id,
    });
    const accessCode = await createAccessCode(org.id, building.id, {
      label: "Front door",
      code: "4417#",
    });

    // The same month on both sides, unmarked: a mark keyed on the unit's
    // label or the month would find a period in each org.
    const rentPeriod = await createRentPeriod(org.id, building.id, unit.id);

    return {
      org,
      owner,
      member,
      ownerMembership,
      memberMembership,
      sharedMembership,
      invitation,
      building,
      unit,
      contact,
      utility,
      accessCode,
      rentPeriod,
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
    side.building.id,
    side.unit.id,
    side.contact.id,
    side.contact.email!,
    side.utility.id,
    side.accessCode.id,
    side.rentPeriod.id,
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
    // letting a scoped handle write one. And exactly one: a second permissive
    // policy — `for insert ... with check (true)`, say — is OR'd with this one
    // and opens whatever it allows, whatever this one says.
    const policies = await policiesFor(SCOPED_ROLE);

    for (const [table, column] of Object.entries(ORG_OWNED)) {
      const expected = `(${column} = current_org_id())`;

      expect(
        policies[table],
        `${table} should have exactly one permissive policy for ` +
          `${SCOPED_ROLE}, keyed on ${column} — the template is in ` +
          "docs/data-model.md §9.",
      ).toEqual([{ cmd: "ALL", qual: expected, withCheck: expected }]);
    }
  });

  it("gives the scoped role nothing on a table this file has not vetted", async () => {
    // The general form of the rule, rather than a list of tables to check: a
    // grant with no policy behind it is every org's rows, so any table the
    // scoped role can touch must be one a test here has already vetted — an
    // org-owned table the test above holds to its org, or reference data the
    // next test holds to reading. Having *a* policy is not enough since
    // reference data arrived: its `using (true)` is a policy, and on any other
    // table it would be every org's rows with a policy in front of them.
    const vetted = [...Object.keys(ORG_OWNED), ...REFERENCE_TABLES];

    expect(
      (await tablesReachableBy(SCOPED_ROLE)).filter(
        (table) => !vetted.includes(table),
      ),
      `${SCOPED_ROLE} holds privileges on these tables, which are neither ` +
        "org-owned nor reference data.",
    ).toEqual([]);
  });

  it("lets the scoped role read reference data and write none of it", async () => {
    // docs/data-model.md §6 and §9. Every org reads the whole trade list, so
    // the one policy says `using (true)` — and it is `for select`, so a write
    // granted by mistake still finds no policy to admit it. The grant is held
    // to `select` as well, so that mistake is one this test names first.
    const policies = await policiesFor(SCOPED_ROLE);

    for (const table of REFERENCE_TABLES) {
      expect(
        Object.hasOwn(OUTSIDE_THE_BOUNDARY, table),
        `${table} is reference data, so it has no org: name it in OUTSIDE_THE_BOUNDARY.`,
      ).toBe(true);

      expect(
        policies[table],
        `${table} should have exactly one \`for select to ${SCOPED_ROLE} ` +
          "using (true)` policy.",
      ).toEqual([{ cmd: "SELECT", qual: "true", withCheck: null }]);

      const { rows } = await testDb().execute<{
        reads: boolean;
        writes: boolean;
        protected: boolean;
      }>(sql`
        select has_table_privilege(${SCOPED_ROLE}::name, oid, 'select') as reads,
               has_table_privilege(${SCOPED_ROLE}::name, oid,
                 'insert, update, delete') as writes,
               relrowsecurity as protected
        from pg_class
        where relnamespace = 'public'::regnamespace and relname = ${table}
      `);

      expect(rows, table).toEqual([
        { reads: true, writes: false, protected: true },
      ]);
    }
  });

  it("grants neither role a privilege row-level security does not govern", async () => {
    // Policies filter rows for select, insert, update and delete, and for
    // nothing else. `truncate` empties a table without consulting a single
    // policy, so a scoped role holding it on `memberships` could delete every
    // org's rows in one statement while every test above stayed green.
    // `references` and `trigger` are the other two privileges a policy does
    // not see, and neither role has any use for them.
    for (const role of [SCOPED_ROLE, IDENTITY_ROLE]) {
      const { rows } = await testDb().execute<{ relname: string }>(sql`
        select relname from pg_class
        where relnamespace = 'public'::regnamespace and relkind = 'r'
          and has_table_privilege(${role}::name, oid, 'truncate, references, trigger')
        order by relname
      `);

      expect(
        rows.map((row) => row.relname),
        `${role} holds truncate, references or trigger on these tables.`,
      ).toEqual([]);
    }
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

  it("lets no role bypass row-level security", async () => {
    // Either attribute would make every policy above decorative. The migrations
    // create the roles without them; this is what notices if one is altered.
    // The reader is on the list too: it reads every row through a policy that
    // says so, and a bypass would read past every policy, including the ones
    // that do not.
    const { rows } = await testDb().execute<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(sql`
      select rolname, rolsuper, rolbypassrls from pg_roles
      where rolname in (${SCOPED_ROLE}, ${IDENTITY_ROLE}, ${READER_ROLE})
      order by rolname
    `);

    expect(rows).toEqual([
      { rolname: IDENTITY_ROLE, rolsuper: false, rolbypassrls: false },
      { rolname: READER_ROLE, rolsuper: false, rolbypassrls: false },
      { rolname: SCOPED_ROLE, rolsuper: false, rolbypassrls: false },
    ]);
  });

  it("lets the reader read every table and write none", async () => {
    // ADR-0010. A table the reader cannot select from fails the nightly backup
    // outright, which is loud but a day late; this says so on the pull request
    // that adds the table. And a write privilege of any kind is a backup login
    // that can change what it is backing up.
    const { rows } = await testDb().execute<{
      relname: string;
      reads: boolean;
      writes: boolean;
    }>(sql`
      select relname,
             has_table_privilege(${READER_ROLE}::name, oid, 'select') as reads,
             has_table_privilege(${READER_ROLE}::name, oid,
               'insert, update, delete, truncate, references, trigger') as writes
      from pg_class
      where relnamespace = 'public'::regnamespace and relkind = 'r'
      order by relname
    `);

    expect(
      rows.filter((row) => !row.reads).map((row) => row.relname),
      `${READER_ROLE} cannot read these tables — grant it select, which is ` +
        "item 3 of the per-table checklist in docs/data-model.md §9.",
    ).toEqual([]);

    expect(
      rows.filter((row) => row.writes).map((row) => row.relname),
      `${READER_ROLE} holds more than select on these tables.`,
    ).toEqual([]);
  });

  it("gives the reader a read-everything policy on every table with row-level security", async () => {
    // The check the backup cannot make for itself. It dumps with
    // `--enable-row-security`, so a table whose policies do not admit the
    // reader is dumped as empty, restores as empty, and the restore drill's
    // row counts agree with it — both sides are read as the reader. This is
    // the only place the missing policy shows.
    //
    // Exactly one, and read-only: a second permissive policy is OR'd with it,
    // and `for all` would carry a `with check` a write could use.
    const { rows } = await testDb().execute<{ relname: string }>(sql`
      select relname from pg_class
      where relnamespace = 'public'::regnamespace and relkind = 'r'
        and relrowsecurity
      order by relname
    `);

    const policies = await policiesFor(READER_ROLE);

    for (const { relname: table } of rows) {
      expect(
        policies[table],
        `${table} has row-level security and should have exactly one ` +
          `\`for select to ${READER_ROLE} using (true)\` policy, or the ` +
          "nightly backup dumps it empty — the template is in " +
          "docs/data-model.md §9.",
      ).toEqual([{ cmd: "SELECT", qual: "true", withCheck: null }]);
    }
  });

  it("shows the reader every row of both orgs, as the backup will see them", async () => {
    // The catalog checks above, from the other side: what `pg_dump` actually
    // reads when it logs in as the reader and turns row security on. The
    // harness is a superuser, so it can become the reader for one transaction
    // and count through its policies what it has just counted past them.
    await seedTwoOrgs();

    const { rows: tables } = await testDb().execute<{ relname: string }>(sql`
      select relname from pg_class
      where relnamespace = 'public'::regnamespace and relkind = 'r'
      order by relname
    `);

    const [past, through] = await testDb().transaction(async (tx) => {
      async function countEach() {
        const counts: Record<string, number> = {};

        for (const { relname } of tables) {
          const { rows } = await tx.execute<{ count: number }>(
            sql`select count(*)::int as count from ${sql.identifier(relname)}`,
          );

          counts[relname] = rows[0]?.count ?? 0;
        }

        return counts;
      }

      const asHarness = await countEach();

      await tx.execute(sql`set local role ${sql.identifier(READER_ROLE)}`);
      await tx.execute(sql`set local row_security = on`);

      return [asHarness, await countEach()];
    });

    expect(through).toEqual(past);
    // Not a vacuous agreement between two sets of zeroes.
    expect(through.organizations).toBe(2);
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

/**
 * The org switcher (#29) — the one path in the product where the browser names
 * an org on purpose, and so the one where ADR-0003's "ignored, not validated"
 * has to be visible from outside. Each refusal below is checked the same way:
 * the session still points where it did, and nothing redirected — a refused
 * switch must be indistinguishable from a click on the org already open.
 *
 * What is not checked here is the session cookie the switch rewrites (the
 * action says why it matters). The provider writes it through `next/headers`
 * from inside `node_modules`, which `vi.mock` does not reach, so the write
 * lands on the real module and no-ops outside a request.
 */
describe("switchOrganization", () => {
  /** Signs `userId` in, and says which org the session opened in. */
  async function signedInAs(userId: string) {
    const caller = await signIn(userId);

    request.headers = new Headers({ cookie: caller.cookie, origin: APP_URL });

    return { caller, startedIn: await activeOrgOf(caller.sessionId) };
  }

  it("moves a member into another org they belong to", async () => {
    const { a, b, shared } = await seedTwoOrgs();
    const { caller, startedIn } = await signedInAs(shared.id);

    // The oldest membership, per `resolveActiveOrganization()`. Asserted so the
    // switch below is a change and not a coincidence.
    expect(startedIn).toBe(a.org.id);

    await expect(switchOrganization(b.org.id)).rejects.toMatchObject({
      url: "/",
    });

    expect(await activeOrgOf(caller.sessionId)).toBe(b.org.id);

    request.headers = new Headers({ cookie: caller.cookie });

    expect((await getOrgContext()).org.id).toBe(b.org.id);
  });

  it("ignores another tenant's org", async () => {
    const { a, b } = await seedTwoOrgs();
    const { caller } = await signedInAs(a.owner.id);
    const before = await rowsOwnedBy(b.org.id);

    await expect(switchOrganization(b.org.id)).resolves.toBeUndefined();

    expect(await activeOrgOf(caller.sessionId)).toBe(a.org.id);
    expect(await rowsOwnedBy(b.org.id)).toEqual(before);
  });

  it("ignores an org whose deletion stopped access", async () => {
    // `docs/data-model.md` §7: the membership outlives a soft delete by design,
    // for the thirty days before the purge. Better Auth's own membership check
    // sees that row and would let the switch through; the list this action
    // consults is the one that knows the org is gone.
    const { a, b, shared } = await seedTwoOrgs();

    await testDb()
      .update(organizations)
      .set({ deletedAt: new Date() })
      .where(eq(organizations.id, b.org.id));

    const { caller } = await signedInAs(shared.id);

    await expect(switchOrganization(b.org.id)).resolves.toBeUndefined();

    expect(await activeOrgOf(caller.sessionId)).toBe(a.org.id);
  });

  it.each([
    ["nothing", undefined],
    ["a number", 42],
    ["a string that is not an id", "not-an-org"],
  ])("ignores %s", async (_, requested) => {
    const { a, shared } = await seedTwoOrgs();
    const { caller } = await signedInAs(shared.id);

    await expect(switchOrganization(requested)).resolves.toBeUndefined();

    expect(await activeOrgOf(caller.sessionId)).toBe(a.org.id);
  });

  it("ignores a real id wrapped in something that is not one", async () => {
    // `===` against a string is what makes these miss. A lookup that coerced —
    // `String(requested)`, a loose `==` — would unwrap the array and switch.
    const { a, b, shared } = await seedTwoOrgs();
    const { caller } = await signedInAs(shared.id);

    for (const requested of [[b.org.id], { id: b.org.id }]) {
      await expect(switchOrganization(requested)).resolves.toBeUndefined();
    }

    expect(await activeOrgOf(caller.sessionId)).toBe(a.org.id);
  });
});

/**
 * The building form's paths — `src/server/queries/buildings.ts` and
 * `src/server/actions/buildings.ts` — driven the way a page and a form drive
 * them: a signed session, then the function, with nothing naming an org. Every
 * id they are handed is B's where the probe is about B, and each is checked the
 * same way as the switcher: B's rows unchanged, and none of B's identifiers in
 * what came back.
 */
describe("the building paths", () => {
  async function signedInAs(side: Side) {
    const caller = await signIn(side.owner.id);
    request.headers = new Headers({ cookie: caller.cookie, origin: APP_URL });
  }

  /** The edit form for `side`'s building, prefilled as the page prefills it. */
  function formFor(side: Side) {
    return buildingFields(side.building, [side.unit]);
  }

  function mentionsB(result: unknown, b: Side): string[] {
    const text = JSON.stringify(result);
    return identifiersOf(b).filter((id) => text.includes(id));
  }

  it("lists only the caller's buildings", async () => {
    const { a } = await seedTwoOrgs();
    await signedInAs(a);

    const listed = await listBuildings();

    expect(listed.map((building) => building.id)).toEqual([a.building.id]);
    expect(listed[0]?.unitCount).toBe(1);
  });

  it("reads the caller's building, and not the other org's by its id", async () => {
    const { a, b } = await seedTwoOrgs();
    await signedInAs(a);

    const mine = await getBuilding(a.building.id);
    expect(mine?.units.map((unit) => unit.id)).toEqual([a.unit.id]);

    expect(await getBuilding(b.building.id)).toBeNull();
  });

  it("edits the caller's building, and leaves the other org's alone", async () => {
    const { a, b } = await seedTwoOrgs();
    await signedInAs(a);
    const before = await rowsOwnedBy(b.org.id);

    const result = await buildingActions.updateBuilding(a.building.id, {
      ...formFor(a),
      label: "Renamed duplex",
    });

    expect(result).toEqual({ ok: true, buildingId: a.building.id });
    expect((await getBuilding(a.building.id))?.building.label).toBe(
      "Renamed duplex",
    );
    expect(await rowsOwnedBy(b.org.id)).toEqual(before);
  });

  it("refuses to edit the other org's building", async () => {
    const { a, b } = await seedTwoOrgs();
    await signedInAs(a);
    const before = await rowsOwnedBy(b.org.id);

    const result = await buildingActions.updateBuilding(b.building.id, {
      ...formFor(b),
      label: "Renamed duplex",
    });

    expect(result.ok).toBe(false);
    expect(mentionsB(result, b)).toEqual([]);
    expect(await rowsOwnedBy(b.org.id)).toEqual(before);
  });

  it("refuses the other org's unit smuggled into the caller's building", async () => {
    // The id is a lookup into A's building's own units. B's unit is not one,
    // so the save is refused whole — A's building is not half-edited either.
    const { a, b } = await seedTwoOrgs();
    await signedInAs(a);
    const theirs = await rowsOwnedBy(b.org.id);
    const mine = await rowsOwnedBy(a.org.id);

    const form = formFor(a);
    const result = await buildingActions.updateBuilding(a.building.id, {
      ...form,
      label: "Renamed duplex",
      units: [...form.units, { ...form.units[0]!, id: b.unit.id, label: "B" }],
    });

    expect(result.ok).toBe(false);
    expect(mentionsB(result, b)).toEqual([]);
    expect(await rowsOwnedBy(b.org.id)).toEqual(theirs);
    expect(await rowsOwnedBy(a.org.id)).toEqual(mine);
  });

  it("archives and restores only the caller's building", async () => {
    const { a, b } = await seedTwoOrgs();
    await signedInAs(a);
    const before = await rowsOwnedBy(b.org.id);

    expect(await buildingActions.archiveBuilding(b.building.id)).toEqual({
      ok: false,
    });
    expect(await buildingActions.restoreBuilding(b.building.id)).toEqual({
      ok: false,
    });
    expect(await rowsOwnedBy(b.org.id)).toEqual(before);

    // The control: the same calls work at home.
    expect(await buildingActions.archiveBuilding(a.building.id)).toEqual({
      ok: true,
    });
    expect(await buildingActions.restoreBuilding(a.building.id)).toEqual({
      ok: true,
    });
  });

  it("creates in the caller's org, whatever org the submission names", async () => {
    // An extra `orgId` is not a field the form has, and it is dropped with
    // the rest of what the schema does not describe — ignored, not validated.
    const { a, b } = await seedTwoOrgs();
    await signedInAs(a);
    const before = await rowsOwnedBy(b.org.id);

    const result = await buildingActions.createBuilding({
      ...formFor(a),
      units: [{ ...formFor(a).units[0]!, id: null }],
      orgId: b.org.id,
    });

    expect(result.ok).toBe(true);
    expect((await rowsOwnedBy(a.org.id)).buildings).toHaveLength(2);
    expect(await rowsOwnedBy(b.org.id)).toEqual(before);
  });
});

/**
 * The contact book's paths — `src/server/queries/contacts.ts` and
 * `src/server/actions/contacts.ts` — driven as the page and the modal drive
 * them, and judged as the building paths are. The two orgs' plumbers share a
 * name and a phone number, so a lookup keyed on either would find both.
 */
describe("the contact paths", () => {
  async function signedInAs(side: Side) {
    const caller = await signIn(side.owner.id);
    request.headers = new Headers({ cookie: caller.cookie, origin: APP_URL });
  }

  /** The modal for `side`'s contact, prefilled as the page prefills it. */
  function formFor(side: Side) {
    return contactFields({ ...side.contact, trades: ["plumber"] });
  }

  function mentionsB(result: unknown, b: Side): string[] {
    const text = JSON.stringify(result);
    return identifiersOf(b).filter((id) => text.includes(id));
  }

  it("lists only the caller's contacts", async () => {
    const { a } = await seedTwoOrgs();
    await signedInAs(a);

    const listed = await listContacts();

    expect(listed.map((contact) => contact.id)).toEqual([a.contact.id]);
    expect(listed[0]?.trades).toEqual(["plumber"]);
  });

  it("reads the caller's contact, and not the other org's by its id", async () => {
    const { a, b } = await seedTwoOrgs();
    await signedInAs(a);

    expect((await getContact(a.contact.id))?.id).toBe(a.contact.id);
    expect(await getContact(b.contact.id)).toBeNull();
  });

  it("reads the whole trade list, which belongs to no org", async () => {
    // The control for the reference-data exemption: the scoped handle reads
    // every trade, and the list is the same from either side.
    const { a, b } = await seedTwoOrgs();

    await signedInAs(a);
    const fromA = await listTradeTags();
    await signedInAs(b);
    const fromB = await listTradeTags();

    expect(fromA).toHaveLength(19);
    expect(fromB).toEqual(fromA);
  });

  it("edits the caller's contact, and leaves the other org's alone", async () => {
    const { a, b } = await seedTwoOrgs();
    await signedInAs(a);
    const before = await rowsOwnedBy(b.org.id);

    const result = await contactActions.updateContact(a.contact.id, {
      ...formFor(a),
      trades: ["plumber", "handyman"],
    });

    expect(result).toEqual({ ok: true, contactId: a.contact.id });
    expect((await getContact(a.contact.id))?.trades).toEqual([
      "handyman",
      "plumber",
    ]);
    expect(await rowsOwnedBy(b.org.id)).toEqual(before);
  });

  it("refuses to edit the other org's contact or its trades", async () => {
    const { a, b } = await seedTwoOrgs();
    await signedInAs(a);
    const before = await rowsOwnedBy(b.org.id);

    const result = await contactActions.updateContact(b.contact.id, {
      ...formFor(b),
      name: "Renamed",
      trades: [],
    });

    expect(result.ok).toBe(false);
    expect(mentionsB(result, b)).toEqual([]);
    expect(await rowsOwnedBy(b.org.id)).toEqual(before);
  });

  it("archives and restores only the caller's contact", async () => {
    const { a, b } = await seedTwoOrgs();
    await signedInAs(a);
    const before = await rowsOwnedBy(b.org.id);

    expect(await contactActions.archiveContact(b.contact.id)).toEqual({
      ok: false,
    });
    expect(await rowsOwnedBy(b.org.id)).toEqual(before);

    // The control: the same call works at home.
    expect(await contactActions.archiveContact(a.contact.id)).toEqual({
      ok: true,
    });

    // And restoring needs an archived contact, which B's now is.
    await testDb()
      .update(contacts)
      .set({ archivedAt: new Date() })
      .where(eq(contacts.id, b.contact.id));
    const archived = await rowsOwnedBy(b.org.id);

    expect(await contactActions.restoreContact(b.contact.id)).toEqual({
      ok: false,
    });
    expect(await rowsOwnedBy(b.org.id)).toEqual(archived);
    expect(await contactActions.restoreContact(a.contact.id)).toEqual({
      ok: true,
    });
  });

  it("creates in the caller's org, whatever org the submission names", async () => {
    const { a, b } = await seedTwoOrgs();
    await signedInAs(a);
    const before = await rowsOwnedBy(b.org.id);

    const result = await contactActions.createContact({
      ...formFor(a),
      orgId: b.org.id,
    });

    expect(result.ok).toBe(true);
    expect((await rowsOwnedBy(a.org.id)).contacts).toHaveLength(2);
    expect(await rowsOwnedBy(b.org.id)).toEqual(before);
  });
});

/**
 * The facts card's paths — `src/server/queries/building-facts.ts` and
 * `src/server/actions/building-facts.ts` — judged as the building paths are.
 * The two orgs' front doors have the same code, sealed for each, so a reveal
 * that found B's row would return the digits A expects and look like it
 * worked: it is the ids that tell.
 */
describe("the building facts paths", () => {
  async function signedInAs(side: Side) {
    const caller = await signIn(side.owner.id);
    request.headers = new Headers({ cookie: caller.cookie, origin: APP_URL });
  }

  function mentionsB(result: unknown, b: Side): string[] {
    const text = JSON.stringify(result);
    return identifiersOf(b).filter((id) => text.includes(id));
  }

  /** The editor for `side`'s building, prefilled as the page prefills it. */
  async function editorFor(side: Side) {
    return buildingFactsFields(await getBuildingFacts(side.building.id));
  }

  it("reads the caller's facts, and nothing of the other org's by its building's id", async () => {
    const { a, b } = await seedTwoOrgs();
    await signedInAs(a);

    const mine = await getBuildingFacts(a.building.id);
    expect(mine.accessCodes.map((code) => code.id)).toEqual([a.accessCode.id]);
    expect(mine.utilities.map((utility) => utility.id)).toEqual([a.utility.id]);

    const theirs = await getBuildingFacts(b.building.id);
    expect(theirs).toEqual({
      trashDay: null,
      recyclingDay: null,
      recyclingNote: null,
      utilities: [],
      accessCodes: [],
    });
  });

  it("reveals the caller's code, and not the other org's by its id", async () => {
    const { a, b } = await seedTwoOrgs();
    await signedInAs(a);

    expect(await revealAccessCode(a.accessCode.id)).toEqual({
      ok: true,
      code: "4417#",
    });

    const theirs = await revealAccessCode(b.accessCode.id);
    expect(theirs).toEqual({ ok: false });
    expect(mentionsB(theirs, b)).toEqual([]);
  });

  it("saves the caller's facts, and leaves the other org's alone", async () => {
    const { a, b } = await seedTwoOrgs();
    await signedInAs(a);
    const before = await rowsOwnedBy(b.org.id);

    const result = await saveBuildingFacts(a.building.id, {
      ...(await editorFor(a)),
      trashDay: "fri",
    });

    expect(result).toEqual({ ok: true });
    expect((await getBuildingFacts(a.building.id)).trashDay).toBe("fri");
    expect(await rowsOwnedBy(b.org.id)).toEqual(before);
  });

  it("refuses to save the other org's facts", async () => {
    const { a, b } = await seedTwoOrgs();
    await signedInAs(a);
    const before = await rowsOwnedBy(b.org.id);

    const result = await saveBuildingFacts(b.building.id, {
      ...(await editorFor(a)),
      accessCodes: [],
      utilities: [],
      trashDay: "fri",
    });

    expect(result.ok).toBe(false);
    expect(mentionsB(result, b)).toEqual([]);
    expect(await rowsOwnedBy(b.org.id)).toEqual(before);
  });

  it.each([
    [
      "the other org's code",
      (editor: Awaited<ReturnType<typeof editorFor>>, b: Side) => ({
        ...editor,
        accessCodes: [
          ...editor.accessCodes,
          { ...emptyAccessCodeFields(), id: b.accessCode.id },
        ],
      }),
    ],
    [
      "the other org's utility",
      (editor: Awaited<ReturnType<typeof editorFor>>, b: Side) => ({
        ...editor,
        utilities: [
          ...editor.utilities,
          {
            ...emptyUtilityFields("gas"),
            id: b.utility.id,
            providerName: "Citizens Energy",
          },
        ],
      }),
    ],
    [
      "the other org's unit",
      (editor: Awaited<ReturnType<typeof editorFor>>, b: Side) => ({
        ...editor,
        accessCodes: [
          { ...emptyAccessCodeFields(), unitId: b.unit.id, code: "9999" },
        ],
      }),
    ],
    [
      "the other org's contact",
      (editor: Awaited<ReturnType<typeof editorFor>>, b: Side) => ({
        ...editor,
        utilities: [{ ...emptyUtilityFields("snow"), contactId: b.contact.id }],
      }),
    ],
  ])("refuses %s smuggled into the caller's facts", async (_, smuggle) => {
    // Refused whole: A's facts are not half-saved either.
    const { a, b } = await seedTwoOrgs();
    await signedInAs(a);
    const theirs = await rowsOwnedBy(b.org.id);
    const mine = await rowsOwnedBy(a.org.id);

    const result = await saveBuildingFacts(
      a.building.id,
      smuggle({ ...(await editorFor(a)), trashDay: "fri" }, b),
    );

    expect(result.ok).toBe(false);
    expect(mentionsB(result, b)).toEqual([]);
    expect(await rowsOwnedBy(b.org.id)).toEqual(theirs);
    expect(await rowsOwnedBy(a.org.id)).toEqual(mine);
  });
});

/**
 * A scoped handle for the owner of `side`'s org, reached the way every domain
 * query will reach one: a signed session, then `getOrgContext()`. Not
 * `forOrg()`, which ESLint keeps out of this file for the reason
 * `eslint.config.mjs` gives — and the real path is the one worth proving anyway.
 */
async function scopedHandleFor(side: Side) {
  const caller = await signIn(side.owner.id);
  request.headers = new Headers({ cookie: caller.cookie });

  const { db } = await getOrgContext();

  return db;
}

/**
 * ADR-0003's worst case: a query that forgot its `org_id` filter. Nothing in the
 * SQL below says which org it is for, so every row it cannot reach is one
 * row-level security kept out of reach — which is the claim #28 exists to make
 * true. Each statement runs as org A's owner, the most privileged role an org
 * has, so a refusal is the database's and never the application's.
 *
 * Over every table in `ORG_OWNED`, so a table added there is covered here the
 * day it lands.
 */
describe.each(Object.entries(ORG_OWNED))(
  "%s, through a scoped handle with no org filter",
  (table, column) => {
    const target = sql.identifier(table);
    const owner = sql.identifier(column);

    it("reads only the scoped org's rows", async () => {
      const { a } = await seedTwoOrgs();
      const db = await scopedHandleFor(a);

      const { rows } = await db.run((tx) =>
        tx.execute<{ owner: string }>(
          sql`select ${owner}::text as owner from ${target}`,
        ),
      );

      // Every one of A's rows, not merely none of B's: a policy that filtered
      // everything out would pass the second half on its own.
      const owned = (await rowsOwnedBy(a.org.id))[table] ?? [];

      expect(rows).toHaveLength(owned.length);
      expect(rows.filter((row) => row.owner !== a.org.id)).toEqual([]);
    });

    it("updates only the scoped org's rows", async () => {
      const { a, b } = await seedTwoOrgs();
      const db = await scopedHandleFor(a);
      const before = await rowsOwnedBy(b.org.id);

      // A no-op assignment, so the rows `returning` reports are exactly the
      // rows the update's scan could reach — which is the question. A real
      // change would be caught by the snapshot below too, but a no-op leaves
      // `updated_at` alone and the snapshot blind, so `returning` is the proof.
      const { rows } = await db.run((tx) =>
        tx.execute<{ owner: string }>(
          sql`update ${target} set ${owner} = ${owner}
              returning ${owner}::text as owner`,
        ),
      );

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.filter((row) => row.owner !== a.org.id)).toEqual([]);
      expect(await rowsOwnedBy(b.org.id)).toEqual(before);
    });

    it("deletes only the scoped org's rows, or is refused outright", async () => {
      const { a, b } = await seedTwoOrgs();
      const db = await scopedHandleFor(a);
      const before = await rowsOwnedBy(b.org.id);

      // Three acceptable outcomes, and which one a table gets is the
      // migration's decision rather than this test's: `organizations`,
      // `contacts`, `building_facts` and `rent_periods` have no DELETE grant
      // for the scoped role — an org is soft-deleted and the purge is not a
      // request, a contact is archived, a building's facts are cleared rather
      // than removed, and a vacant month is marked rather than deleted — so
      // they are refused before any row is considered. `buildings` is refused
      // by its units' `restrict`, because every seeded building has one (§7:
      // archived, not deleted), and `units` by the electric account and the
      // month of rent on each. The others may delete, and must delete only
      // A's. A refusal rolls the transaction back, and the snapshot below is
      // what says B was never touched either way.
      const outcome = await db
        .run((tx) =>
          tx.execute<{ owner: string }>(
            sql`delete from ${target} returning ${owner}::text as owner`,
          ),
        )
        .then(
          ({ rows }) => rows.filter((row) => row.owner !== a.org.id),
          (error: unknown) => postgresErrorCode(error),
        );

      expect([[], INSUFFICIENT_PRIVILEGE, RESTRICT_VIOLATION]).toContainEqual(
        outcome,
      );
      expect(await rowsOwnedBy(b.org.id)).toEqual(before);
    });

    it("cannot move one of its rows into another org", async () => {
      // The write `with check` exists for. `using` alone would keep B's rows
      // out of sight and still let a scoped handle hand one of its own to B —
      // or, by the same clause, write a new row there.
      const { a, b } = await seedTwoOrgs();
      const db = await scopedHandleFor(a);
      const before = await rowsOwnedBy(b.org.id);

      await expect(
        db.run((tx) =>
          tx.execute(sql`update ${target} set ${owner} = ${b.org.id}`),
        ),
      ).rejects.toSatisfy(rejectsWith(INSUFFICIENT_PRIVILEGE));

      expect(await rowsOwnedBy(b.org.id)).toEqual(before);
    });
  },
);

/**
 * The write `with check` cannot catch. A policy judges the row being written,
 * and the unit below is A's by every column the policy reads; the building it
 * points at is B's. Postgres checks a foreign key past row-level security, so
 * with a plain `building_id` reference this insert succeeds even though A
 * cannot see the building it names — `docs/data-model.md` §9 asks for exactly
 * this case, and `units_building` is what refuses it. Every composite
 * reference after it gets the same pair of cases.
 */
describe("a reference from one org's row to another's", () => {
  it("lets a unit into the scoped org's own building", async () => {
    // The control: the insert below is well-formed, and fails only for B.
    const { a } = await seedTwoOrgs();
    const db = await scopedHandleFor(a);

    await db.run((tx) =>
      tx.execute(
        sql`insert into units (org_id, building_id, label)
            values (${a.org.id}, ${a.building.id}, 'B')`,
      ),
    );

    expect((await rowsOwnedBy(a.org.id)).units).toHaveLength(2);
  });

  it("refuses a unit in another org's building", async () => {
    const { a, b } = await seedTwoOrgs();
    const db = await scopedHandleFor(a);
    const before = await rowsOwnedBy(b.org.id);

    await expect(
      db.run((tx) =>
        tx.execute(
          sql`insert into units (org_id, building_id, label)
              values (${a.org.id}, ${b.building.id}, 'B')`,
        ),
      ),
    ).rejects.toSatisfy(rejectsWith(FOREIGN_KEY_VIOLATION));

    expect(await rowsOwnedBy(b.org.id)).toEqual(before);
    expect((await rowsOwnedBy(a.org.id)).units).toHaveLength(1);
  });

  it("refuses to move a unit into another org's building", async () => {
    const { a, b } = await seedTwoOrgs();
    const db = await scopedHandleFor(a);

    await expect(
      db.run((tx) =>
        tx.execute(
          sql`update units set building_id = ${b.building.id}
              where id = ${a.unit.id}`,
        ),
      ),
    ).rejects.toSatisfy(rejectsWith(FOREIGN_KEY_VIOLATION));
  });

  // The same shape one table over: a tag that is A's by its `org_id`, on B's
  // contact. `contact_tags_contact` names the org, so it is refused.
  it("lets a tag onto the scoped org's own contact", async () => {
    const { a } = await seedTwoOrgs();
    const db = await scopedHandleFor(a);

    await db.run((tx) =>
      tx.execute(
        sql`insert into contact_tags (org_id, contact_id, tag)
            values (${a.org.id}, ${a.contact.id}, 'handyman')`,
      ),
    );

    expect((await rowsOwnedBy(a.org.id)).contact_tags).toHaveLength(2);
  });

  it("refuses a tag on another org's contact", async () => {
    const { a, b } = await seedTwoOrgs();
    const db = await scopedHandleFor(a);
    const before = await rowsOwnedBy(b.org.id);

    await expect(
      db.run((tx) =>
        tx.execute(
          sql`insert into contact_tags (org_id, contact_id, tag)
              values (${a.org.id}, ${b.contact.id}, 'handyman')`,
        ),
      ),
    ).rejects.toSatisfy(rejectsWith(FOREIGN_KEY_VIOLATION));

    expect(await rowsOwnedBy(b.org.id)).toEqual(before);
    expect((await rowsOwnedBy(a.org.id)).contact_tags).toHaveLength(1);
  });

  // And the facts tables, whose rows name a building, a unit or a contact.
  // One control, then each reference pointed at B: facts on B's building, an
  // account on B's building, unit or contact, and a code on B's building or
  // unit. The code's secret is A's own, so only the reference is wrong.
  it("lets facts, a utility and a code onto the scoped org's own rows", async () => {
    const { a } = await seedTwoOrgs();
    const db = await scopedHandleFor(a);

    await db.run(async (tx) => {
      await tx.execute(
        sql`update building_facts set trash_day = 'fri'
            where building_id = ${a.building.id}`,
      );
      await tx.execute(
        sql`insert into building_utilities (org_id, building_id, unit_id, kind, contact_id)
            values (${a.org.id}, ${a.building.id}, ${a.unit.id}, 'gas', ${a.contact.id})`,
      );
      await tx.execute(
        sql`insert into building_access_codes (org_id, building_id, unit_id, kind, secret, key_version)
            select org_id, building_id, ${a.unit.id}, 'lockbox', secret, key_version
            from building_access_codes where id = ${a.accessCode.id}`,
      );
    });

    const owned = await rowsOwnedBy(a.org.id);
    expect(owned.building_utilities).toHaveLength(2);
    expect(owned.building_access_codes).toHaveLength(2);
  });

  it.each([
    [
      "facts for another org's building",
      (a: Side, b: Side) =>
        sql`insert into building_facts (org_id, building_id)
            values (${a.org.id}, ${b.building.id})`,
    ],
    [
      "a utility on another org's building",
      (a: Side, b: Side) =>
        sql`insert into building_utilities (org_id, building_id, kind)
            values (${a.org.id}, ${b.building.id}, 'gas')`,
    ],
    [
      "a utility on another org's unit",
      (a: Side, b: Side) =>
        sql`insert into building_utilities (org_id, building_id, unit_id, kind)
            values (${a.org.id}, ${a.building.id}, ${b.unit.id}, 'gas')`,
    ],
    [
      "a utility naming another org's contact",
      (a: Side, b: Side) =>
        sql`update building_utilities set contact_id = ${b.contact.id}
            where id = ${a.utility.id}`,
    ],
    [
      "a code on another org's building",
      (a: Side, b: Side) =>
        sql`insert into building_access_codes (org_id, building_id, kind, secret, key_version)
            select org_id, ${b.building.id}, kind, secret, key_version
            from building_access_codes where id = ${a.accessCode.id}`,
    ],
    [
      "a code on another org's unit",
      (a: Side, b: Side) =>
        sql`update building_access_codes set unit_id = ${b.unit.id}
            where id = ${a.accessCode.id}`,
    ],
    [
      "a rent period on another org's unit",
      (a: Side, b: Side) =>
        sql`insert into rent_periods (org_id, building_id, unit_id, period_month, amount_expected_cents)
            values (${a.org.id}, ${b.building.id}, ${b.unit.id}, '2026-10-01', 230000)`,
    ],
    [
      "a rent period counted toward another org's building",
      (a: Side, b: Side) =>
        sql`update rent_periods set building_id = ${b.building.id}
            where id = ${a.rentPeriod.id}`,
    ],
  ])("refuses %s", async (_, statement) => {
    const { a, b } = await seedTwoOrgs();
    const db = await scopedHandleFor(a);
    const theirs = await rowsOwnedBy(b.org.id);
    const mine = await rowsOwnedBy(a.org.id);

    await expect(db.run((tx) => tx.execute(statement(a, b)))).rejects.toSatisfy(
      rejectsWith(FOREIGN_KEY_VIOLATION),
    );

    expect(await rowsOwnedBy(b.org.id)).toEqual(theirs);
    expect(await rowsOwnedBy(a.org.id)).toEqual(mine);
  });

  // The control for the two rent-period cases above: A's own unit takes a
  // second month, so the inserts fail for naming B and for nothing else.
  it("lets a rent period onto the scoped org's own unit", async () => {
    const { a } = await seedTwoOrgs();
    const db = await scopedHandleFor(a);

    await db.run((tx) =>
      tx.execute(
        sql`insert into rent_periods (org_id, building_id, unit_id, period_month, amount_expected_cents)
            values (${a.org.id}, ${a.building.id}, ${a.unit.id}, '2026-10-01', 230000)`,
      ),
    );

    expect((await rowsOwnedBy(a.org.id)).rent_periods).toHaveLength(2);
  });
});
