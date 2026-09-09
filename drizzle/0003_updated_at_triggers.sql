-- The three `updated_at` triggers for the tables `0002` added. Hand-written,
-- like `0001`, because Drizzle does not model triggers — the generator ignores
-- this file, which is why the drift check stays clean.
--
-- `set_updated_at()` is created once, by `0001`. Each new table adds only its
-- own trigger, and every one of them is the same three lines with a different
-- table name. `docs/data-model.md` §1: `updated_at` is maintained by the
-- database rather than by the application, so a manual UPDATE cannot leave it
-- stale — and here that also means a write from Better Auth's own connection
-- path cannot, which is the case that matters for `users`.
--
-- `WHEN (OLD.* IS DISTINCT FROM NEW.*)` on all three, for the same reason as
-- `organizations`: an UPDATE that changes nothing must not move the timestamp,
-- or `updated_at` comes to mean "last touched" rather than "last changed".

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER memberships_set_updated_at
  BEFORE UPDATE ON memberships
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER invitations_set_updated_at
  BEFORE UPDATE ON invitations
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION set_updated_at();
