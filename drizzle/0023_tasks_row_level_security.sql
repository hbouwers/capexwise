-- The half of `tasks` Drizzle does not model: four of its references, its
-- `updated_at` trigger, the rule that a changed date or assignee clears a
-- confirmation, its grants, and `docs/data-model.md` §9's row-level security.
-- Hand-written, like `0019`, so the generator ignores it and the drift check
-- stays clean.

-- **The informational references, each `set null` of its one column.** A
-- composite key's plain `set null` nulls every column in it — `org_id` and
-- `building_id` too, which the row cannot lose — so each names the column it
-- clears, as Postgres 15 allows and Drizzle cannot say. Each names the org as
-- well, for §9's fifth item: a foreign key is checked past row-level security,
-- and the policy alone would let a task point into another org.
--
-- The capital item and the parent name the building too, so a task cannot be
-- about another building's furnace, or recur from another building's task.
ALTER TABLE tasks ADD CONSTRAINT tasks_capital_item
  FOREIGN KEY (org_id, building_id, capital_item_id)
  REFERENCES capital_items (org_id, building_id, id)
  ON DELETE SET NULL (capital_item_id);
--> statement-breakpoint
-- A vendor. Contacts are archived rather than deleted (§7), so this fires only
-- for the true delete nothing in v0 offers — and a task is never lost with its
-- vendor.
ALTER TABLE tasks ADD CONSTRAINT tasks_assignee_contact
  FOREIGN KEY (org_id, assignee_contact_id)
  REFERENCES contacts (org_id, id)
  ON DELETE SET NULL (assignee_contact_id);
--> statement-breakpoint
-- A member (#94): the membership, keyed by `memberships_org_user`, so the
-- assignee is somebody in this org. Revoking the membership unassigns the task.
ALTER TABLE tasks ADD CONSTRAINT tasks_assignee_member
  FOREIGN KEY (org_id, assignee_user_id)
  REFERENCES memberships (org_id, user_id)
  ON DELETE SET NULL (assignee_user_id);
--> statement-breakpoint
-- The occurrence that wrote this one. Undo on a completion deletes the child,
-- never the parent, so nothing in the product fires this; it is here so that a
-- delete that did would unlink the chain rather than be refused by it.
ALTER TABLE tasks ADD CONSTRAINT tasks_recurrence_parent
  FOREIGN KEY (org_id, building_id, recurrence_parent_id)
  REFERENCES tasks (org_id, building_id, id)
  ON DELETE SET NULL (recurrence_parent_id);
--> statement-breakpoint

-- `set_updated_at()` is `0001`'s, with the same `WHEN`, so an update that
-- changes nothing leaves the timestamp alone — which is also what lets
-- `tasks_delete_as_materialised` below tell an untouched occurrence from one
-- somebody has edited.
CREATE TRIGGER tasks_set_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- **A changed date or assignee clears the confirmation** (#93). A booking with
-- the old vendor for the old day is not a booking of the new one. Held here
-- rather than in the actions, so the task modal, the scheduled row, and the
-- `set null` of a deleted contact or a revoked membership all obey it — the
-- last two are updates the application never sees.
--
-- Unless the same statement sets `confirmed_on` itself: that is the modal
-- saving a new day and confirming it at once, and the new value is the answer.
--
-- It runs before `tasks_confirmed_is_booked` is checked, so unassigning a
-- confirmed task clears the confirmation instead of being refused for leaving
-- one behind. `search_path` is pinned for `0001`'s reason.
CREATE FUNCTION tasks_clear_confirmation() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
  AS $$
BEGIN
  IF NEW.confirmed_on IS NOT DISTINCT FROM OLD.confirmed_on
    AND (NEW.due_date IS DISTINCT FROM OLD.due_date
      OR NEW.assignee_contact_id IS DISTINCT FROM OLD.assignee_contact_id
      OR NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id)
  THEN
    NEW.confirmed_on := NULL;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tasks_clear_confirmation
  BEFORE UPDATE OF due_date, assignee_contact_id, assignee_user_id ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION tasks_clear_confirmation();
--> statement-breakpoint

-- The scoped role, granted what the product does with a task (§9): it is
-- added, edited, scheduled, confirmed, completed and cancelled, and every one
-- of those is an insert or an update. The one `delete` is Undo on a
-- completion, which takes back the occurrence the completion wrote — and it
-- comes with the restrictive policy below, as `0021`'s does.
--
-- Nothing for `capexwise_identity` (ADR-0007).
GRANT SELECT, INSERT, UPDATE, DELETE ON tasks TO capexwise_scoped;
--> statement-breakpoint

-- The backup's reader, `0007`, which names every table after it itself.
GRANT SELECT ON tasks TO capexwise_reader;
--> statement-breakpoint

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- One org's rows, read and written.
CREATE POLICY tasks_org_isolation ON tasks
  FOR ALL
  TO capexwise_scoped
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint

-- **Only an occurrence a completion wrote, untouched since, is deleted.** Every
-- other task is history — a cancelled job still happened to be planned — and
-- is cancelled rather than deleted (§7). `updated_at = created_at` is what
-- "untouched" means: both are the insert's `now()`, and `set_updated_at()`
-- moves the second on any change at all, a confirmation or a note included.
--
-- Restrictive, so it is AND'd with `tasks_org_isolation` rather than OR'd, and
-- the org rule still decides which rows are in reach.
CREATE POLICY tasks_delete_as_materialised ON tasks
  AS RESTRICTIVE
  FOR DELETE
  TO capexwise_scoped
  USING (
    recurrence_parent_id IS NOT NULL
    AND updated_at = created_at
  );
--> statement-breakpoint

-- Every row, read only, for the nightly backup (`0007`).
CREATE POLICY tasks_backup_read ON tasks
  FOR SELECT
  TO capexwise_reader
  USING (true);
