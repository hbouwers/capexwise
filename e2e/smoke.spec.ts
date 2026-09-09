import { expect, test } from "@playwright/test";

/**
 * One test, asserting the application boots and serves a styled page.
 *
 * #21 asks for a smoke test that signs in and lands on the portfolio screen.
 * Neither exists yet — authentication is #25 and the screens are #12 — so this
 * is that test's stand-in and not a smaller version of it: it covers the same
 * ground the container workflow covers with `curl`, in a browser, which is what
 * makes it extensible into the real one. When sign-in lands, this file gets the
 * flow and keeps the assertions below as the thing that runs after it.
 *
 * The assertions are deliberately about the plumbing rather than about the
 * placeholder's contents. `src/app/page.tsx` is scaffolding and will be replaced;
 * a test pinned to its markup would be deleted along with it and would have
 * caught nothing in between. What must not break is that the route renders, that
 * the CSS applies, and that the fonts resolve — the three failures that produce a
 * page which looks broken while every process exits zero.
 */
test.describe("the application shell", () => {
  test("serves the root route", async ({ page }) => {
    const response = await page.goto("/");

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("CapExWise");
    await expect(
      page.getByRole("heading", { level: 1, name: "CapExWise" }),
    ).toBeVisible();
  });

  test("applies its stylesheet", async ({ page }) => {
    await page.goto("/");

    // The same failure `.github/workflows/container.yml` checks for by fetching
    // the stylesheet URL, asserted from the other end: a page that renders with
    // no CSS keeps its default transparent body and serves HTTP 200 while
    // looking entirely broken.
    const background = await page
      .locator("body")
      .evaluate((body) => getComputedStyle(body).backgroundColor);

    expect(background).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("loads the IBM Plex families", async ({ page }) => {
    await page.goto("/");

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
