-- The half of `transactions` and `schedule_e_categories` Drizzle does not
-- model: two of the ledger's references, the `updated_at` triggers, the grants,
-- and `docs/data-model.md` §9's row-level security. Hand-written, like `0023`,
-- so the generator ignores it and the drift check stays clean.

-- **The informational references, each `set null` of its one column** —
-- `0023`'s reason: a composite key's plain `set null` would null `org_id` and
-- `building_id` too, which the row cannot lose. Each names the org as well,
-- for §9's fifth item: a foreign key is checked past row-level security.
--
-- The task names the building too, so an expense cannot be for another
-- building's job. Only Undo on a completion deletes a task, and it takes back
-- an occurrence nobody has touched; an expense recorded against one is
-- unlinked rather than refusing the Undo.
ALTER TABLE transactions ADD CONSTRAINT transactions_task
  FOREIGN KEY (org_id, building_id, task_id)
  REFERENCES tasks (org_id, building_id, id)
  ON DELETE SET NULL (task_id);
--> statement-breakpoint
-- Who was paid. Contacts are archived rather than deleted (§7), so this fires
-- only for the true delete nothing offers yet — and the expense is never lost
-- with its vendor.
ALTER TABLE transactions ADD CONSTRAINT transactions_contact
  FOREIGN KEY (org_id, contact_id)
  REFERENCES contacts (org_id, id)
  ON DELETE SET NULL (contact_id);
--> statement-breakpoint

-- `set_updated_at()` is `0001`'s, with the same `WHEN`, so an update that
-- changes nothing leaves the timestamp alone.
CREATE TRIGGER schedule_e_categories_set_updated_at
  BEFORE UPDATE ON schedule_e_categories
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER transactions_set_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- The scoped role, granted what the expense modal does (§9): an expense is
-- added, edited and deleted. **Deleted, not voided**: a row entered twice, or
-- against the wrong building, is a typo rather than history, and nothing reads
-- a year as closed until #44 freezes filed years — which is where a filed
-- year's rows stop being deletable, by a restrictive policy of their own.
--
-- `select` and nothing else on the categories. The list is written by
-- migrations and read by everyone.
--
-- Nothing for `capexwise_identity` on either (ADR-0007).
GRANT SELECT, INSERT, UPDATE, DELETE ON transactions TO capexwise_scoped;
--> statement-breakpoint
GRANT SELECT ON schedule_e_categories TO capexwise_scoped;
--> statement-breakpoint

-- The backup's reader, `0007`, which names every table after it itself.
GRANT SELECT ON schedule_e_categories, transactions TO capexwise_reader;
--> statement-breakpoint

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE transactions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- One org's rows, read and written.
CREATE POLICY transactions_org_isolation ON transactions
  FOR ALL
  TO capexwise_scoped
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint

-- Reference data, as `trade_tags` is in `0012`: enabled so the grant is not the
-- only thing between a request and a write, and **not forced**, so the owner
-- that runs the migrations can seed it in `0027`.
ALTER TABLE schedule_e_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY schedule_e_categories_read ON schedule_e_categories
  FOR SELECT
  TO capexwise_scoped
  USING (true);
--> statement-breakpoint

-- Every row, read only, for the nightly backup (`0007`).
CREATE POLICY schedule_e_categories_backup_read ON schedule_e_categories
  FOR SELECT
  TO capexwise_reader
  USING (true);
--> statement-breakpoint
CREATE POLICY transactions_backup_read ON transactions
  FOR SELECT
  TO capexwise_reader
  USING (true);
