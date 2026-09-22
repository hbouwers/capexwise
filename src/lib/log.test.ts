/**
 * What is worth holding here is not that `JSON.stringify` works. It is the two
 * claims ADR-0013 makes about every line this application writes, both of which
 * fail silently and neither of which anybody would notice from reading a log:
 *
 * 1. A value that is somebody's email or phone number does not reach the line.
 * 2. An id still does — including the ones that happen to contain a long run of
 *    digits, which is the false positive that would make rule 1 useless by
 *    redacting the fields that make a log worth keeping.
 *
 * The second is a regression test rather than a hypothesis: CI has already
 * produced a UUID containing a digits-only substring, which is recorded in
 * `src/server/actions/building-facts.integration.test.ts`. Without the UUID
 * exemption in `scrub()`, that line would have come out with its org redacted
 * on some runs and not others.
 */
import { describe, expect, it } from "vitest";

import { REDACTED, formatEvent, scrub } from "@/lib/log";

/** A fixed clock, so the assertions below are about the line and not the time. */
const AT = new Date("2026-09-22T12:00:00.000Z");

describe("scrub", () => {
  describe("what must not reach a log line", () => {
    it("redacts an email address", () => {
      expect(scrub("someone@example.com")).toBe(REDACTED);
    });

    it("redacts an email address embedded in a longer value", () => {
      // The realistic shape: not a field called `email`, but a message that
      // happens to quote one.
      expect(scrub("invite sent to someone@example.com")).toBe(REDACTED);
    });

    it("redacts a phone number", () => {
      expect(scrub("3175550142")).toBe(REDACTED);
      expect(scrub("tel: 3175550142")).toBe(REDACTED);
    });
  });

  describe("what has to survive, or the log is not worth writing", () => {
    it("keeps a UUID that contains a long run of digits", () => {
      // The regression. Seven consecutive digits inside a v7 timestamp is
      // uncommon and not rare, and the id is the field the line exists for.
      const id = "01993456-7890-7abc-8def-0123456789ab";

      expect(scrub(id)).toBe(id);
    });

    it("keeps an ordinary UUID", () => {
      const id = "0199b2c4-8f3a-7c21-9d5e-1a2b3c4d5e6f";

      expect(scrub(id)).toBe(id);
    });

    it("keeps numbers, flags and enum values", () => {
      expect(scrub(5)).toBe(5);
      expect(scrub(0)).toBe(0);
      expect(scrub(true)).toBe(true);
      expect(scrub(null)).toBeNull();
      expect(scrub("revealed")).toBe("revealed");
    });

    it("keeps a year and a count, which four digits would have caught", () => {
      // Why the threshold is seven and not four: these are the numbers a
      // capital-item line is made of.
      expect(scrub("2026")).toBe("2026");
      expect(scrub(2026)).toBe(2026);
    });
  });
});

describe("formatEvent", () => {
  it("writes the envelope every line is filtered by", () => {
    const line = JSON.parse(
      formatEvent({ log: "demo_reset", orgId: "org-1" }, AT),
    );

    expect(line).toEqual({
      log: "demo_reset",
      level: "info",
      org_id: "org-1",
      at: "2026-09-22T12:00:00.000Z",
    });
  });

  it("carries a null org rather than omitting the field", () => {
    // "No org" and "somebody forgot" have to be different lines. An absent key
    // makes them the same one.
    const line = JSON.parse(formatEvent({ log: "signed_up", orgId: null }, AT));

    expect(line).toHaveProperty("org_id", null);
  });

  it("scrubs the fields it is handed", () => {
    const line = JSON.parse(
      formatEvent(
        {
          log: "contact_saved",
          orgId: "org-1",
          fields: { contact_id: "c-1", phone: "3175550142" },
        },
        AT,
      ),
    );

    expect(line.contact_id).toBe("c-1");
    expect(line.phone).toBe(REDACTED);
  });

  it("does not let a field displace the envelope", () => {
    // The collision worth preventing: a line that parses, reads as ordinary,
    // and names the wrong tenant.
    const line = JSON.parse(
      formatEvent(
        {
          log: "access_code",
          orgId: "org-1",
          fields: { log: "something_else", org_id: "org-2", level: "error" },
        },
        AT,
      ),
    );

    expect(line.log).toBe("access_code");
    expect(line.org_id).toBe("org-1");
    expect(line.level).toBe("info");
  });

  it("writes one line, so that one event parses as one record", () => {
    const line = formatEvent(
      { log: "demo_reset", orgId: "org-1", fields: { note: "a\nb" } },
      AT,
    );

    expect(line).not.toContain("\n");
  });
});
