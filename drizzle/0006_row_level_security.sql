-- Row-level security, the second of ADR-0003's two layers (#28). Hand-written,
-- like `0001`, `0003` and `0005`: Drizzle models neither roles, grants nor
-- `FORCE`, so the generator ignores this file, which is why the drift check
-- stays clean. `docs/data-model.md` §9 is the per-table template and ADR-0007
-- is the decision about which code runs as which role.
--
-- Two roles, both NOLOGIN. Nothing connects as either; they are what a
-- connection *becomes*:
--
--   capexwise_scoped    What `forOrg().run()` switches to, with SET LOCAL ROLE,
--                       for the length of one transaction. Every query through a
--                       scoped handle runs as this role — never the owner, never
--                       a superuser — so it sees one org's rows and cannot write
--                       another's, whatever role the connection logged in as.
--   capexwise_identity  The sign-in path: Better Auth, and the join in
--                       `resolveOrgForUser()` that decides which org a session
--                       may act in. Both run before there is an org to scope by,
--                       so this role is what the policies let through on the
--                       three tables that establish the boundary — and it has no
--                       business on any table inside it.
--
-- Roles belong to the server, not to a database, so they are created only if
-- absent: the integration suite migrates `capexwise_test` on the same server as
-- `capexwise`, and the second run finds them already there.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'capexwise_scoped') THEN
    CREATE ROLE capexwise_scoped NOLOGIN NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'capexwise_identity') THEN
    CREATE ROLE capexwise_identity NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

-- The role running this is, today, also the role the application logs in as:
-- the compose superuser locally and in CI, and on Neon the one role behind both
-- the direct endpoint CI migrates through and the pooled one Vercel serves from.
-- So it is granted both, each in the one way it needs.
--
-- `capexwise_scoped` with SET and without INHERIT: the login role may *become*
-- the scoped role, which is all `forOrg()` asks of it, but does not carry the
-- scoped role's policies around when it is being itself.
--
-- `capexwise_identity` with INHERIT, and this one is load-bearing on Neon rather
-- than a formality. The login role there owns the tables, `FORCE` below subjects
-- an owner to its own policies, and an owner with no policy that applies to it
-- sees nothing — measured, not assumed. Without this grant, sign-in would find no
-- membership for anybody, try to create each of them a new org, and have the
-- insert refused. A superuser or a BYPASSRLS login skips the policies entirely,
-- so the grant is harmless where it is not needed.
--
-- Re-granting a membership that already exists is a notice, not an error, so
-- this is safe on the second database of a shared server too.
GRANT capexwise_scoped TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
--> statement-breakpoint
GRANT capexwise_identity TO CURRENT_USER WITH INHERIT TRUE, SET FALSE;
--> statement-breakpoint

-- The org a scoped transaction is acting for, or null outside one. Every policy
-- compares against this rather than repeating the expression, for two reasons.
--
-- The setting's name is spelled once in SQL. `ORG_ID_SETTING` in
-- `src/server/org-context.ts` is the only other spelling and a test ties the
-- two together — which matters because a policy that misspelled it would not
-- raise, it would filter out every row.
--
-- And `nullif`. A setting applied with SET LOCAL reads back as '' rather than
-- null once its transaction ends, and `''::uuid` raises. Without it, a query
-- that reached the scoped role without a context would return nothing on a fresh
-- connection and a type error on a reused one: two behaviours, chosen by which
-- connection the pool happened to hand out.
--
-- No `SET search_path`, unlike `set_updated_at()`, and deliberately. A function
-- with a SET clause is never inlined, and inlining is what lets
-- `org_id = current_org_id()` use an index that leads with `org_id` — which
-- ADR-0003 requires of every index on a domain table. Every name inside is
-- schema-qualified instead, so there is no search_path for anyone to redirect.
CREATE FUNCTION current_org_id() RETURNS uuid
  LANGUAGE sql
  STABLE
  AS $$
    SELECT nullif(pg_catalog.current_setting('app.current_org_id', true), '')::pg_catalog.uuid
  $$;
--> statement-breakpoint

-- What each role may do at all, before a policy says to which rows. A table
-- not named here is `permission denied` for that role, which fails loudly —
-- the direction a forgotten grant should fail in.
--
-- `organizations` gets no INSERT and no DELETE from the scoped role. An org is
-- created on the identity path, at sign-in, by `resolveActiveOrganization()` in
-- `src/server/auth.ts`: a scoped handle is by definition already inside an org,
-- so there is no org context from which creating one makes sense, and §9's
-- question of who may create an org is answered by who holds the grant. Deleting
-- one is a soft delete, which is an UPDATE; the hard delete 30 days later is a
-- maintenance job, not a request (`docs/data-model.md` §7).
--
-- The scoped role gets nothing on `users` either, though a members list will
-- want names. `users` has no `org_id` and no policy, so SELECT on it would be
-- every account's email address; reading them through `memberships` is a
-- policy of its own, and it belongs with the screen that needs it (#30).
GRANT SELECT, UPDATE ON organizations TO capexwise_scoped;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON memberships, invitations TO capexwise_scoped;
--> statement-breakpoint

-- Everything Better Auth reads and writes, and nothing else. A login role that
-- is not the owner — the hardening ADR-0007 leaves for later — reaches the
-- database only through this list, so a domain table that is not on it is out
-- of reach of the unscoped client entirely.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON users, sessions, accounts, verifications, rate_limits,
     organizations, memberships, invitations
  TO capexwise_identity;
--> statement-breakpoint

-- `docs/data-model.md` §9's template, on the three tables that carry an org.
-- ENABLE turns the policies on; FORCE extends them to the table's owner, which
-- Postgres otherwise exempts — without it RLS is enabled, reports itself as
-- enabled, and does nothing for a connection that logged in as the owner.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- The scoped role: one org's rows, for reading and for writing. `WITH CHECK` as
-- well as `USING`, or a scoped handle could not see org B's rows but could
-- still insert one, or move one of its own rows into B.
--
-- `organizations` is keyed on `id` because it is the boundary rather than a
-- table inside it. There is no `deleted_at is null` here, which §9 left open:
-- the scoped role only ever carries the id of an org `resolveOrgForUser()` has
-- just found live, so the soft delete is enforced before the context exists
-- rather than by the policy — and a USING clause that hid deleted orgs would
-- make the soft delete itself, an UPDATE through a scoped handle, refuse to
-- write a row it would then be unable to see.
CREATE POLICY organizations_org_isolation ON organizations
  FOR ALL
  TO capexwise_scoped
  USING (id = current_org_id())
  WITH CHECK (id = current_org_id());
--> statement-breakpoint
CREATE POLICY memberships_org_isolation ON memberships
  FOR ALL
  TO capexwise_scoped
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint
CREATE POLICY invitations_org_isolation ON invitations
  FOR ALL
  TO capexwise_scoped
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint

-- The identity path: every row of the three tables that establish the boundary,
-- because deciding which org somebody may act in means reading memberships that
-- are not yet anybody's context. This is the narrow, deliberate bypass ADR-0007
-- records — narrow because it covers these three tables and no others, and a
-- test in `src/server/cross-org-isolation.integration.test.ts` fails if a policy
-- like this appears on any fourth one. A domain table never gets one.
CREATE POLICY organizations_identity_path ON organizations
  FOR ALL
  TO capexwise_identity
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY memberships_identity_path ON memberships
  FOR ALL
  TO capexwise_identity
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY invitations_identity_path ON invitations
  FOR ALL
  TO capexwise_identity
  USING (true)
  WITH CHECK (true);
