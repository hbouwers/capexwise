/**
 * Per-file lifecycle for the integration suite: one connection for the file, and
 * an empty database in front of every test.
 *
 * Truncating *before* each test rather than after is deliberate. After-cleanup
 * leaves the database dirty whenever a test fails partway, so the next run of a
 * single test with `-t` starts from whatever the last failure left behind — and
 * the rerun then fails for a different reason than the original. Before-cleanup
 * makes each test's starting state a property of the test rather than of what
 * ran before it.
 *
 * Rolling back a transaction per test would be faster, but it would also mean no
 * test could observe committed state or exercise anything that commits — and the
 * policies in #28 are enforced against committed rows.
 */
import { afterAll, beforeAll, beforeEach } from "vitest";

import { closeTestConnection, openTestConnection, truncateAll } from "./db";

beforeAll(async () => {
  await openTestConnection();
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeTestConnection();
});
