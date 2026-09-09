import { expect, test } from "@playwright/test";

/**
 * The application boots, protects what it should, and serves a styled page.
 *
 * #21 asks for a smoke test that signs in and lands on the portfolio screen.
 * **Half of that is now possible and half is still not.** The redirect that
 * protects the application is real and is asserted below; completing the sign-in
 * is not, and will not be from here — ADR-0004 chose Google OAuth as the only
 * method in v0, and finishing that round trip in CI means either a real Google
 * account with a real password in a secret, or a mock provider that proves the
 * mock works. Neither is worth what it costs. The flow past the redirect gets
 * covered when there is a screen for it (#12), by seeding a session directly.
 *
 * The rendering assertions moved from `/` to `/sign-in` when `/` became
 * protected, which is the only page a signed-out browser can reach. They are
 * deliberately about the plumbing rather than about the page's contents: that
 * markup is provisional and will be redrawn, and a test pinned to it would be
 * deleted along with it having caught nothing in between. What must not break is
 * that a route renders, that the CSS applies, and that the fonts resolve — the
 * three failures that produce a page which looks broken while every process
 * exits zero.
 */
test.describe("the protected application", () => {
  test("sends a signed-out browser to sign in", async ({ page }) => {
    await page.goto("/");

    // The pattern in `src/server/session.ts`, end to end: `requireSession()`
    // redirects, and nothing of the page behind it is rendered or sent.
    await expect(page).toHaveURL("/sign-in");
    await expect(
      page.getByRole("button", { name: "Continue with Google" }),
    ).toBeVisible();
  });
});

test.describe("the application shell", () => {
  test("serves the sign-in route", async ({ page }) => {
    const response = await page.goto("/sign-in");

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("Sign in — CapExWise");
    await expect(
      page.getByRole("heading", { level: 1, name: "CapExWise" }),
    ).toBeVisible();
  });

  test("applies its stylesheet", async ({ page }) => {
    await page.goto("/sign-in");

    // The same failure the container job checks for by fetching the stylesheet
    // URL, asserted from the other end: a page that renders with no CSS keeps
    // its default transparent body and serves HTTP 200 while looking entirely
    // broken.
    const background = await page
      .locator("body")
      .evaluate((body) => getComputedStyle(body).backgroundColor);

    expect(background).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("loads the IBM Plex families", async ({ page }) => {
    await page.goto("/sign-in");

    // `next/font` self-hosts these and exposes each as a CSS variable that
    // `globals.css` reads. If the variable is missing the browser silently falls
    // back down the stack — to Arial or Segoe UI, which have no Medium weight,
    // so 45 deliberate 500/600 weights collapse to two and nothing reports it.
    // That is the exact failure `docs/ui/components.md` §12 rejected the system
    // stack over, and it is invisible unless something asserts on it.
    const fontFamily = await page
      .locator("body")
      .evaluate((body) => getComputedStyle(body).fontFamily);

    expect(fontFamily).toMatch(/plex/i);
  });
});
