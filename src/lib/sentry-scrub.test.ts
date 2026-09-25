/**
 * The claim under test is ADR-0013's: nothing that could be somebody's data
 * reaches Sentry. It is worth a test rather than a comment because the failure
 * is invisible from inside the application — the error still arrives, the stack
 * is still right, and the only place the leak is visible is a vendor's web UI
 * that nobody opens until something has already gone wrong.
 *
 * The events below are shaped like the SDK's, not imported from it. That is the
 * point of the structural type in `sentry-scrub.ts`: these assertions are about
 * what survives, and they should not need rewriting when Sentry renames a field
 * this file does not touch.
 */
import { describe, expect, it } from "vitest";

import { scrubEvent } from "@/lib/sentry-scrub";

/** An event shaped the way the SDK builds one for a failed server action. */
function eventWithRequest() {
  return {
    request: {
      url: "https://capexwise.com/buildings/0199b2c4-8f3a-7c21-9d5e-1a2b3c4d5e6f?tenant=jane%40example.com",
      method: "POST",
      headers: { cookie: "session=abc", "user-agent": "Firefox" },
      cookies: { session: "abc" },
      data: { name: "Jane Doe", phone: "3175550142" },
      query_string: "tenant=jane%40example.com",
    },
    user: { email: "owner@example.com", ip_address: "203.0.113.4" },
  };
}

describe("scrubEvent", () => {
  describe("the request", () => {
    it("removes the body, which is where a server action's arguments are", () => {
      // The realistic leak: `saveContact` throws, and the argument to
      // `saveContact` is a contact.
      expect(scrubEvent(eventWithRequest()).request.data).toBeUndefined();
    });

    it("removes headers and cookies, which carry the session", () => {
      const event = scrubEvent(eventWithRequest());

      expect(event.request.headers).toBeUndefined();
      expect(event.request.cookies).toBeUndefined();
    });

    it("removes the query string, and the copy of it inside the url", () => {
      const event = scrubEvent(eventWithRequest());

      expect(event.request.query_string).toBeUndefined();
      expect(event.request.url).not.toContain("tenant");
      expect(event.request.url).not.toContain("example.com");
    });

    it("keeps the route, which is the part worth having", () => {
      // Strip too much and the event says an error happened somewhere.
      const event = scrubEvent(eventWithRequest());

      expect(event.request.url).toBe(
        "https://capexwise.com/buildings/0199b2c4-8f3a-7c21-9d5e-1a2b3c4d5e6f",
      );
      expect(event.request.method).toBe("POST");
    });

    it("removes the user even though nothing here sets one", () => {
      // `sendDefaultPii: false` is a setting, and settings get changed.
      expect(scrubEvent(eventWithRequest()).user).toBeUndefined();
    });
  });

  describe("breadcrumbs", () => {
    it("drops the ones that record what was clicked or typed", () => {
      // "Reveal code for 1442 Woodlawn Ave" is a breadcrumb and an address.
      const event = scrubEvent({
        breadcrumbs: [
          { category: "navigation" },
          { category: "ui.click" },
          { category: "ui.input" },
          { category: "fetch" },
        ],
      });

      expect(event.breadcrumbs.map((crumb) => crumb.category)).toEqual([
        "navigation",
        "fetch",
      ]);
    });
  });

  describe("events that are not shaped as expected", () => {
    it("does not throw on an event with no request", () => {
      // An error thrown outside a request — a cron, a boot failure. A
      // `beforeSend` that throws loses the error it was called about.
      expect(() => scrubEvent({})).not.toThrow();
    });

    it("does not throw on a url with no query string", () => {
      const event = scrubEvent({ request: { url: "https://capexwise.com/" } });

      expect(event.request.url).toBe("https://capexwise.com/");
    });

    it("does not throw on a relative or malformed url", () => {
      // `new URL()` throws on both, which is why this is string surgery.
      expect(
        scrubEvent({ request: { url: "/forecast?year=2026" } }).request.url,
      ).toBe("/forecast");
      expect(scrubEvent({ request: { url: "not a url" } }).request.url).toBe(
        "not a url",
      );
    });
  });
});
