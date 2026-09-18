/**
 * The auth provider, configured once. [ADR-0004](../../docs/adr/0004-auth-provider.md)
 * is the decision this file implements: **Better Auth, with our Postgres
 * authoritative for organizations and memberships**, and Google OAuth as the
 * only way in during v0 — apart from a demo visit, which is an anonymous account
 * that can reach the demo org and nothing else (ADR-0011).
 *
 * Two things about this module are load-bearing rather than incidental.
 *
 * **It is one of the files `eslint.config.mjs` lets past the raw-database rule.**
 * `src/db/client.ts` explains why that is not a hole; the short version is that
 * the provider reads the four tables that sit above the tenancy boundary by
 * construction, and reaches the three that sit below it only through the
 * organization plugin's own endpoints, which scope by the signed-in user's
 * membership.
 *
 * **The version is pinned exactly** — `better-auth@1.7.3`, no caret. ADR-0004
 * committed to that: the package is the youngest dependency in the stack, minor
 * releases have moved its API, and the mapping below is written against a schema
 * this version reports. `advanced.database.validateSchema` is the check that
 * turns a mismatch after an upgrade into a boot failure naming the field rather
 * than a 500 on somebody's first sign-in.
 */
import "server-only";

import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { anonymous } from "better-auth/plugins/anonymous";
import { organization } from "better-auth/plugins/organization";
import { memberAc, ownerAc } from "better-auth/plugins/organization/access";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { memberships, organizations } from "@/db/schema";
import { env } from "@/server/env";

/**
 * The two roles `membership_role` holds, and deliberately not the three Better
 * Auth ships with.
 *
 * Left at the default, the plugin would happily write `"admin"` into
 * `memberships.role` — a native enum with no such value, so the first attempt
 * fails on a constraint deep in the provider rather than anywhere a reader would
 * look. Naming the roles here means the plugin and the column agree, and it
 * means the third role the PRD's management-group persona wants arrives as one
 * `ALTER TYPE` and one line here rather than as a discovery.
 *
 * `ownerAc` and `memberAc` are Better Auth's own permission sets for those two
 * names, taken unchanged. Rewriting them is a decision for whenever there is a
 * permission this product actually disagrees with the library about.
 */
const roles = { owner: ownerAc, member: memberAc };

/**
 * What a brand-new account's first organization is called.
 *
 * A placeholder with a short life: #39 owns onboarding and will ask properly,
 * because the first screen after sign-in is the one that has to get a building
 * entered fast. Until then a name that is obviously *theirs* beats "Untitled",
 * which reads like something went wrong.
 *
 * The first whitespace-separated token of the provider's `name`, falling back to
 * the local part of the email when Google returns no name. The possessive is
 * naive on a name ending in "s" and that is accepted rather than special-cased:
 * the rule that gets it right is per-language, the string is user-editable, and
 * #39 replaces the whole thing.
 */
function firstOrganizationName(user: { name?: string | null; email: string }) {
  const [firstName] = (user.name ?? "").trim().split(/\s+/);
  const [localPart] = user.email.split("@");

  return `${firstName || localPart || "My"}'s portfolio`;
}

/**
 * A slug for that organization: readable, and unique without a round trip.
 *
 * The random suffix is not decoration. `organizations.slug` is unique across
 * every tenant, so two people called Holden signing up would collide on
 * `holden-s-portfolio` — and the loser's sign-in would fail on a constraint
 * violation with no way for them to fix it. Six hex characters make that
 * collision a retry-free non-event.
 *
 * It is also why the slug is not derived from anything sensitive: it appears in
 * URLs, and CLAUDE.md's rule about non-sequential identifiers is the same
 * reasoning one layer up — what a stranger can read out of a URL should be
 * nothing.
 */
function slugify(name: string) {
  const stem = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return `${stem || "portfolio"}-${crypto.randomUUID().slice(0, 6)}`;
}

/**
 * Returns the org this session should open in, creating the account's first one
 * if there is not one yet.
 *
 * **This is #25's "sign-up creates a user, an org and an owner membership in one
 * transaction", and it deliberately does not hang off user creation.** A hook on
 * `user.create.after` would cover the sign-up case only, and would leave a user
 * with no org at all if the second write failed — an account that can sign in
 * and then has nowhere to be. Resolving it as the session is created instead
 * makes the whole thing idempotent: it is the sign-up path the first time, a
 * single indexed read every time after, and the repair path if a previous
 * attempt ever half-succeeded.
 *
 * The org and the membership go in one transaction because either alone is
 * wrong. An org with no owner is unreachable and violates the "an org must
 * always have at least one owner" rule in `docs/data-model.md` §2; a membership
 * with no org cannot exist at all, the foreign key sees to that.
 *
 * Returns `null` for a user who is a member of nothing and could not be given
 * anything — which cannot happen today, and is a `null` rather than a throw
 * because failing to pick a *default* org must never be what stops somebody
 * signing in. #26 is where a request with no org context becomes an error, and
 * it has the routing to send them somewhere that says so.
 *
 * **Known race, deliberately left open.** The read and the write are not one
 * atomic step, so two session creations for the same brand-new account, in
 * flight at the same time, would each see no membership and each create an org.
 * Nothing is corrupted — the second org is empty and the account is owner of
 * both — but it is a second free unit under the pricing model and a confusing
 * entry in the org switcher.
 *
 * It is left because the fix is worse than the fault today. Closing it properly
 * means `SELECT ... FOR UPDATE` on the `users` row from this connection, while
 * Better Auth is mid-flow on its own connection, on the sign-in path — trading a
 * rare duplicate row for a possible deadlock at the front door. And the trigger
 * is narrow: two OAuth callbacks for one new account completing within
 * milliseconds, each having consumed its own single-use state token. Revisit
 * with the billing work, which is what makes a duplicate org cost anything.
 */
async function resolveActiveOrganization(user: {
  id: string;
  name?: string | null;
  email: string;
  isAnonymous: boolean;
}): Promise<string | null> {
  if (user.isAnonymous) return await joinDemoOrganization(user.id);

  // Existing membership wins, and the oldest one is the tie-break: for anyone
  // with more than one it is their own org rather than whichever they were most
  // recently invited to. The org switcher (#29) is what changes it afterwards.
  const [existing] = await db()
    .select({ orgId: memberships.orgId })
    .from(memberships)
    .where(eq(memberships.userId, user.id))
    .orderBy(memberships.createdAt)
    .limit(1);

  if (existing) return existing.orgId;

  const name = firstOrganizationName(user);

  return await db().transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({ name, slug: slugify(name) })
      .returning({ id: organizations.id });

    if (!org)
      throw new Error("Creating the first organization returned no row.");

    await tx
      .insert(memberships)
      .values({ orgId: org.id, userId: user.id, role: "owner" });

    return org.id;
  });
}

/**
 * Where a demo visitor's session opens: the demo org, as a `member`, and
 * nowhere else (ADR-0011). An anonymous account never gets an org of its own —
 * that would be a free unit per click — so this is its whole route into the
 * product, and the demo is the only org it can ever act in.
 *
 * `member` rather than `owner`: nothing distinguishes the two yet, and a
 * visitor is the last account that should be first to hold the role that one
 * day will. Idempotent like the rest of the hook, on the membership's unique
 * key.
 *
 * `null` where there is no demo to join. The endpoint refuses a visit before
 * it writes anything in that case (`hooks.before` below), so this is reached
 * only by a visit that raced a reset — and `getOrgContext()` refusing that
 * one session is the right answer.
 */
async function joinDemoOrganization(userId: string): Promise<string | null> {
  const demo = await findLiveDemoOrganization();

  if (!demo) return null;

  await db()
    .insert(memberships)
    .values({ orgId: demo.id, userId, role: "member" })
    .onConflictDoNothing();

  return demo.id;
}

/**
 * The demo org, unless it is soft-deleted — the same `deleted_at is null` that
 * `resolveOrgForUser()` applies, so a visitor is never let into an org that
 * `getOrgContext()` would then refuse to open. `findDemoOrgId()` in
 * `src/server/demo.ts` asks the same question for the sign-in page; it is
 * repeated rather than imported because that module imports this one.
 */
async function findLiveDemoOrganization(): Promise<{ id: string } | null> {
  const [demo] = await db()
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.isDemo, true), isNull(organizations.deletedAt)))
    .limit(1);

  return demo ?? null;
}

function createAuth() {
  return betterAuth({
    appName: "CapExWise",

    // Ours, validated at boot, and never Better Auth's own ambient
    // `BETTER_AUTH_URL`: one name, checked in one place, named in the failure.
    // `src/lib/env-schema.mts` says why it is required rather than derived.
    baseURL: env().APP_URL,
    secret: env().BETTER_AUTH_SECRET,

    // Belt to the same braces as the CSRF checks: a form post from anywhere else
    // is rejected before it reaches an endpoint.
    trustedOrigins: [env().APP_URL],

    database: drizzleAdapter(db(), {
      provider: "pg",

      // Keyed by *our* names, not Better Auth's. The adapter resolves a model to a
      // table by looking it up here after applying the `modelName` mappings below,
      // so these keys and those values have to be the same strings — passing the
      // whole schema namespace is what guarantees they are.
      schema,
    }),

    // The mapping ADR-0004 deferred to `docs/data-model.md` §2 and §2 settled:
    // Better Auth's `user` is our `users`, and so on down. Every rename is here or
    // in the organization plugin's options below, and nowhere else.
    // `session` is renamed further down, where the rest of its configuration is.
    user: { modelName: "users" },
    verification: { modelName: "verifications" },

    account: {
      modelName: "accounts",

      // AES-256-GCM over the three token columns, keyed off `BETTER_AUTH_SECRET`.
      // Off by default, and worth turning on for a reason that is about the
      // repository as much as the product: it goes public at v0.5, database dumps
      // outlive the incidents that produce them, and a Google access token in a
      // dump is a live credential at somebody else's service rather than merely a
      // value of ours. Rotating the secret makes existing tokens undecryptable,
      // which is the correct behaviour after a leak.
      encryptOAuthTokens: true,
    },

    socialProviders: {
      // The only way in during v0 (ADR-0004). No passwords, therefore no password
      // reset and no email verification to own — Google has already verified the
      // address, and `users.email_verified` records what it said.
      google: {
        clientId: env().GOOGLE_CLIENT_ID,
        clientSecret: env().GOOGLE_CLIENT_SECRET,
      },
    },

    session: {
      modelName: "sessions",

      // Thirty days, extended a day at a time. A capital plan is something people
      // open a few times a year, and a landlord signed out between visits will
      // reach for a password manager they do not have — sign-in is Google, and the
      // session is the only thing holding continuity.
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,

      // Caches the session in a signed cookie so an authenticated request does not
      // read `sessions` every time. The cost is stated rather than assumed: a
      // session revoked elsewhere stays usable for up to this long.
      //
      // Five minutes, and the reason it is safe to have at all is that it caches
      // *identity*, not *authority*. `session.activeOrganizationId` rides along in
      // that cookie, and #26's `getOrgContext()` re-checks it against
      // `memberships` on every request regardless — so a cached, stale or tampered
      // org id buys nothing. ADR-0004 is explicit that the session is a hint.
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },

    advanced: {
      database: {
        // The database generates ids, not the library. Better Auth's default is a
        // random string, and `docs/data-model.md` §2 rejected that: a `text`
        // `organizations.id` would make `org_id` a `text` column on twelve domain
        // tables and every index that leads with one. `false` means "use the
        // column default", which is `uuidv7()` (ADR-0005).
        generateId: false,
      },
    },

    rateLimit: {
      // On everywhere, not only in production, which is not Better Auth's default.
      // A limit that exists only where nobody can watch it is a limit nobody has
      // ever seen work — and #25's checklist is blunt about the reason it has to
      // work here: public repo, public product, no excuse.
      enabled: true,

      // In the database rather than in memory, and this is a deployment fact
      // rather than a preference. On Vercel each serverless instance keeps its own
      // counter and instances are created on demand, so an in-memory limit is
      // barely a limit at all against exactly the traffic worth limiting.
      // `src/db/schema/auth.ts` carries the longer version on `rate_limits`.
      storage: "database",
      modelName: "rateLimits",

      customRules: {
        // Starting an OAuth round trip is a deliberate act, and ten in a minute is
        // already someone leaning on the button. The default (100 per 10s) is
        // sized for reads and is far too loose for this one.
        "/sign-in/social": { window: 60, max: 10 },
        // The leg Google redirects back into. Looser than the outbound side
        // because a legitimate retry lands here, and because a limit that bites
        // mid-flow strands somebody at the provider with no way back.
        "/callback/:id": { window: 60, max: 20 },
        // A demo visit writes a user, a session and a membership, so a loop
        // on it is a loop of inserts. Five a minute is more than one person
        // clicking "Explore the demo" ever needs (ADR-0011).
        "/sign-in/anonymous": { window: 60, max: 5 },
      },
    },

    hooks: {
      // No demo, no demo visit. Without this the anonymous endpoint would still
      // write a user and a session wherever nothing has seeded a demo — before
      // the first reset in production, and in every environment that never runs
      // one — and nothing would ever delete them. Refused here, before the
      // plugin writes anything, as a 404: there is nothing at this address to
      // visit.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/anonymous") return;

        if (!(await findLiveDemoOrganization())) {
          throw new APIError("NOT_FOUND", { message: "There is no demo." });
        }
      }),
    },

    databaseHooks: {
      session: {
        create: {
          // Where a new account gets its org. See `resolveActiveOrganization` —
          // it is here rather than on user creation so that it is idempotent, and
          // so that a half-finished sign-up repairs itself on the next attempt.
          before: async (session) => {
            const [user] = await db()
              .select({
                id: schema.users.id,
                name: schema.users.name,
                email: schema.users.email,
                isAnonymous: schema.users.isAnonymous,
              })
              .from(schema.users)
              .where(eq(schema.users.id, session.userId))
              .limit(1);

            if (!user) return;

            return {
              data: {
                ...session,
                activeOrganizationId: await resolveActiveOrganization(user),
              },
            };
          },
        },
      },
    },

    plugins: [
      organization({
        roles,
        creatorRole: "owner",

        // Closed, and this is a pricing decision as much as a scope one. The free
        // unit is per *account* rather than per org (`docs/data-model.md` §2), so
        // an endpoint that lets anyone mint orgs is an endpoint that hands out
        // free units — and there is no screen that needs it: the only org anybody
        // creates in v0 is their first, and `resolveActiveOrganization` makes that
        // one. Reopen it with the work that can count units, not before.
        allowUserToCreateOrganization: false,

        schema: {
          organization: { modelName: "organizations" },
          member: {
            modelName: "memberships",
            // The one field mapping the tenancy boundary actually depends on:
            // ADR-0003 names this column `org_id` on every table, and the Drizzle
            // property is `orgId`. Field names here map to Drizzle *properties*,
            // not to SQL columns.
            fields: { organizationId: "orgId" },
          },
          invitation: {
            modelName: "invitations",
            fields: { organizationId: "orgId" },
          },
          session: {
            // The plugin adds this column to `sessions`, and we keep the house
            // spelling of "org" rather than inheriting "organization" into the one
            // table that would otherwise have both.
            fields: { activeOrganizationId: "activeOrgId" },
          },
        },
      }),

      // A demo visitor (ADR-0011): an account with no email a person owns,
      // written to `users` with `is_anonymous` set, and let into the demo org
      // alone by `joinDemoOrganization` above. The address is the plugin's
      // placeholder on `.invalid`, which by definition receives nothing. If the
      // visitor then signs in with Google, the plugin deletes the anonymous
      // account and the session hook gives the real one its own org.
      anonymous({ generateName: () => "Demo visitor" }),

      // Must stay last. It writes Better Auth's cookies through Next's own cookie
      // API, which is what makes a sign-out from a Server Action take effect
      // without a round trip through the route handler.
      nextCookies(),
    ],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

/**
 * The provider, built once per process on first use.
 *
 * A function rather than a `const` for the same reason `@/server/env` is one:
 * `next build` imports every route and page module to collect its
 * configuration, and building the provider at module scope would make the build
 * itself demand a `BETTER_AUTH_SECRET` and a Google client. `src/server/env.ts`
 * has the longer version, including why the Dockerfile and ADR-0006 make that
 * more than a tidiness argument.
 */
export function getAuth(): ReturnType<typeof createAuth> {
  instance ??= createAuth();

  return instance;
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
