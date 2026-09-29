-- The half of `planned_work` Drizzle does not model: the reference to the
-- expense that carried a plan out, the `updated_at` trigger, the grants, and
-- `docs/data-model.md` §9's row-level security. Hand-written, like `0026`, so
-- the generator ignores it and the drift check stays clean.

-- **The expense, `set null` of its one column**, for `0023`'s reason: a
-- composite key's plain `set null` would null `org_id` too. It names the org
-- as well, for §9's fifth item. It does not name the building, because an
-- expense can be moved to another building after the fact and the plan it
-- carried out stays carried out.
--
-- A deleted expense leaves its plan `done`, with nothing pointing at the
-- money, which the check on the table allows: the work still happened. The
-- tax planner (#144) is what first links an expense to its plan.
ALTER TABLE planned_work ADD CONSTRAINT planned_work_transaction
  FOREIGN KEY (org_id, transaction_id)
  REFERENCES transactions (org_id, id)
  ON DELETE SET NULL (transaction_id);
--> statement-breakpoint

-- `set_updated_at()` is `0001`'s, with the same `WHEN`.
CREATE TRIGGER planned_work_set_updated_at
  BEFORE UPDATE ON planned_work
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- The scoped role, granted what the forecast and the tax planner do (§9): a
-- plan is made, moved and closed. **No `delete`**, because a plan that is given
-- up on is `dropped` and kept as history. The one delete is the cascade from
-- an item the add-equipment Undo takes back, and a cascade needs no grant.
--
-- Nothing for `capexwise_identity` (ADR-0007).
GRANT SELECT, INSERT, UPDATE ON planned_work TO capexwise_scoped;
--> statement-breakpoint

-- The backup's reader, `0007`.
GRANT SELECT ON planned_work TO capexwise_reader;
--> statement-breakpoint

ALTER TABLE planned_work ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE planned_work FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- One org's rows, read and written.
CREATE POLICY planned_work_org_isolation ON planned_work
  FOR ALL
  TO capexwise_scoped
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint

-- Every row, read only, for the nightly backup (`0007`).
CREATE POLICY planned_work_backup_read ON planned_work
  FOR SELECT
  TO capexwise_reader
  USING (true);
