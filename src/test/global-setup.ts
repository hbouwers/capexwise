/**
 * Runs once, before any integration test file, and only for the `integration`
 * project. Creating the database and migrating it belongs here rather than in
 * `setup-integration.ts`, which runs per file: migrating once per file would be
 * a no-op after the first and would still pay for the connection.
 *
 * If Postgres is not up this is where the run fails, so the message says how to
 * start it rather than leaving a connection refused to be interpreted.
 */
import { ensureTestDatabase, testDatabaseTarget } from "./db";

export default async function setup(): Promise<void> {
  try {
    await ensureTestDatabase();
  } catch (error) {
    throw new Error(
      `Could not prepare the test database at ${testDatabaseTarget}.\n\n` +
        "The integration suite needs Postgres. Locally that is `npm run db:up`; " +
        "in CI it is the service container in the `test` job in `.github/workflows/ci.yml`. The " +
        "unit suite needs none of this — `npm test` runs without a database.",
      { cause: error },
    );
  }
}
