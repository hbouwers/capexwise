-- The backup reader (#35, ADR-0010). Hand-written, like `0006`: Drizzle models
-- neither roles, grants nor policies, so the generator ignores this file and the
-- drift check stays clean.
--
-- `capexwise_reader` reads every row of every table and writes none. It is what
-- the nightly backup dumps production as, through a login that holds it,
-- `capexwise_backup`, which is created by hand on production's branch because a
-- committed migration cannot carry its password (README, "Backups").
--
-- It exists because the owner cannot take a backup. `FORCE` subjects the owner to
-- its own policies, and on Neon it has no `BYPASSRLS` — ADR-0007 measured that it
-- sees no row a policy does not admit. So `pg_dump` as the owner fails outright on
-- every table with row-level security, and with `--enable-row-security` it
-- succeeds and writes out every domain table empty. The second is the dangerous
-- one: a backup that restores cleanly and holds nothing is found out on the day
-- it is needed.
--
-- A policy rather than `BYPASSRLS`, for the reasons ADR-0007 turned `BYPASSRLS`
-- down for the identity role: granting it needs a role that already has it, which
-- Neon's owner does not, and it would reach past every policy there will ever be
-- instead of only the ones that say so. The cost is one line per table, and
-- `src/server/cross-org-isolation.integration.test.ts` fails on a table with
-- row-level security that is missing it — because the backup would not fail. It
-- dumps with `--enable-row-security`, and a table the reader has no policy on is
-- dumped as empty.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'capexwise_reader') THEN
    CREATE ROLE capexwise_reader NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

-- `select` on everything, the tables above the boundary included. Most of them
-- are backed up; `sessions`, `verifications` and `rate_limits` are dumped as
-- definitions without their rows (`src/db/backup.mts` says why), and `pg_dump`
-- still takes a lock on each of those, which needs `select`.
--
-- And nothing else: no write, and none of `truncate`, `references` or `trigger`,
-- which no policy governs. The isolation test holds it to that.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO capexwise_reader;
--> statement-breakpoint

-- Drizzle's own bookkeeping, so that a restored database knows which migrations
-- it has had and the next `db:migrate` applies only the ones it has not. The
-- sequence is there because `pg_dump` reads its current value.
GRANT USAGE ON SCHEMA drizzle TO capexwise_reader;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO capexwise_reader;
--> statement-breakpoint
GRANT SELECT ON ALL SEQUENCES IN SCHEMA drizzle TO capexwise_reader;
--> statement-breakpoint

-- Every row, for reading only. `FOR SELECT` rather than `FOR ALL`, so there is no
-- `WITH CHECK` to get wrong: with no insert, update or delete policy for the
-- role, a write would be refused by the policies even if a grant ever let one
-- through.
CREATE POLICY organizations_backup_read ON organizations
  FOR SELECT
  TO capexwise_reader
  USING (true);
--> statement-breakpoint
CREATE POLICY memberships_backup_read ON memberships
  FOR SELECT
  TO capexwise_reader
  USING (true);
--> statement-breakpoint
CREATE POLICY invitations_backup_read ON invitations
  FOR SELECT
  TO capexwise_reader
  USING (true);
