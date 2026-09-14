-- The half of the contact book's tables Drizzle does not model: their
-- `updated_at` triggers, their grants, and `docs/data-model.md` §9's row-level
-- security. Hand-written, like `0010`, so the generator ignores it and the
-- drift check stays clean.
--
-- Two kinds of table, and they are protected differently. `contacts` and
-- `contact_tags` are an org's, and get §9's template exactly as `buildings`
-- did. `trade_tags` is reference data — no org, one list every org reads — and
-- gets the read-only half of it, below.

-- `set_updated_at()` is `0001`'s. Same three lines per table, and the same
-- `WHEN`, so an update that changes nothing leaves the timestamp alone.
CREATE TRIGGER trade_tags_set_updated_at
  BEFORE UPDATE ON trade_tags
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER contacts_set_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER contact_tags_set_updated_at
  BEFORE UPDATE ON contact_tags
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- The scoped role, granted only what the contact modal does (§9). A contact is
-- created, edited and archived — archiving is an update — and never deleted:
-- §7 allows a true delete only of a contact nothing references, and nothing in
-- the product offers one, so the grant waits for the feature that does. Its
-- tags are all four, because unticking a trade deletes the row.
--
-- `select` and nothing else on `trade_tags`. The list is written by migrations
-- and read by everyone, so no request has a reason to change it.
--
-- Nothing for `capexwise_identity` on any of the three (ADR-0007).
GRANT SELECT, INSERT, UPDATE ON contacts TO capexwise_scoped;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON contact_tags TO capexwise_scoped;
--> statement-breakpoint
GRANT SELECT ON trade_tags TO capexwise_scoped;
--> statement-breakpoint

-- The backup's reader, `0007`, which names every table after it itself.
GRANT SELECT ON trade_tags, contacts, contact_tags TO capexwise_reader;
--> statement-breakpoint

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE contact_tags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE contact_tags FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- One org's rows, read and written. `contact_tags_contact` names the org as
-- well as the contact, because the policy judges a tag's own `org_id` and a
-- foreign key is checked past it — `units_building`'s reason, §9's fifth item.
CREATE POLICY contacts_org_isolation ON contacts
  FOR ALL
  TO capexwise_scoped
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint
CREATE POLICY contact_tags_org_isolation ON contact_tags
  FOR ALL
  TO capexwise_scoped
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint

-- Reference data. Row-level security is enabled so that the grant is not the
-- only thing between a request and a write: with a `select` policy and no
-- other, an `insert` granted to the scoped role by mistake would still be
-- refused, because no policy admits it. Every org reads every row, so the
-- policy's `using` is `true` — which is what §9 means by a deliberate one.
--
-- **Not forced**, and that is the difference from the two tables above. `FORCE`
-- subjects the owner to the policies, and the owner is the role that runs the
-- migrations — `0013` seeds this table as it, and a later one will add to it.
-- Forcing would refuse those inserts, and would protect nothing: `FORCE` exists
-- to keep one org's rows from an owner login, and there is no org here.
ALTER TABLE trade_tags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY trade_tags_read ON trade_tags
  FOR SELECT
  TO capexwise_scoped
  USING (true);
--> statement-breakpoint

-- Every row, read only, for the nightly backup — without these it would dump
-- all three tables empty and the restore drill could not tell (`0007`).
CREATE POLICY trade_tags_backup_read ON trade_tags
  FOR SELECT
  TO capexwise_reader
  USING (true);
--> statement-breakpoint
CREATE POLICY contacts_backup_read ON contacts
  FOR SELECT
  TO capexwise_reader
  USING (true);
--> statement-breakpoint
CREATE POLICY contact_tags_backup_read ON contact_tags
  FOR SELECT
  TO capexwise_reader
  USING (true);
