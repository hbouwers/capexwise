import { expect, test } from "@playwright/test";

/**
 * The uptime check's own end (#36, ADR-0013). `docs/runbooks/observability.md`
 * points a third-party checker at `/api/health` every five minutes, and every
 * one of the properties that makes that check worth trusting is invisible from
 * inside the application:
 *
 * - **It answers without a session.** The route sits outside the protected
 *   tree, so nothing redirects it — but "outside the protected tree" is a
 *   property of where the file is, and files move.
 * - **It is not cached.** Everything the handler returns is known at build
 *   time, so Next.js would be entitled to prerender it, and a prerendered
 *   `/api/health` is served by the CDN through an outage. The check would then
 *   pass while production is down, which is worse than having no check, because
 *   it is a check somebody trusts.
 *
 * Neither can be asserted by a unit test, because both are about what the
 * framework does with the module rather than what the module returns.
 */
test.describe("the health check", () => {
  test("answers 200 to a request with no session", async ({ request }) => {
    const response = await request.get("/api/health");

    expect(response.status()).toBe(200);
    // The body the runbook tells the checker to match on. A checker that only
    // watched the status code would pass on any 200 the platform invented.
    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  test("forbids every cache between here and the checker", async ({
    request,
  }) => {
    const response = await request.get("/api/health");

    // `force-dynamic` governs Next's own cache and this header governs
    // everything downstream of it. Both have to say no, or the answer the
    // checker reads is somebody's copy of a server that has since died.
    expect(response.headers()["cache-control"]).toContain("no-store");
  });

  test("reports a release rather than omitting one", async ({ request }) => {
    const body = await (await request.get("/api/health")).json();

    // `unknown` off Vercel, which is what CI is. What matters is that the field
    // is always there: the runbook's first diagnostic step is comparing this
    // against the commit that was deployed, and an absent field makes "not
    // deployed" and "no field" the same observation.
    expect(body.release).toBeTruthy();
  });
});
