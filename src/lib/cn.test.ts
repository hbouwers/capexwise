/**
 * These are regression tests for a bug that already happened, not hypotheses.
 *
 * `cn` resolves conflicting Tailwind classes by group, so it has to know which
 * group each class belongs to. Three of the type-scale steps in
 * `docs/ui/tokens.md` are not in its default table, and an unknown `text-*` is
 * assumed to be a colour — so `text-micro` and `text-primary-foreground` looked
 * like two colours, the first was discarded as the loser of a conflict that was
 * not one, and a badge rendered at 13px instead of 10px with nothing logged
 * anywhere. `src/lib/cn.ts` registers the names; this is what keeps them
 * registered.
 *
 * The failure mode is why this is worth testing at all: a class silently
 * vanishing produces wrong pixels and no error, which is exactly the kind of
 * thing that survives review and a manual pass over the page.
 */
import { describe, expect, it } from "vitest";

import { cn } from "@/lib/cn";

describe("cn", () => {
  describe("the custom groups from tokens.md", () => {
    it("keeps a custom font-size next to a colour", () => {
      // The original bug, in one line. Without the `font-size` registration
      // this returns `text-primary-foreground` alone.
      expect(cn("text-micro", "text-primary-foreground")).toBe(
        "text-micro text-primary-foreground",
      );
    });

    it("keeps the custom tracking next to a colour", () => {
      expect(cn("tracking-label", "text-primary-foreground")).toBe(
        "tracking-label text-primary-foreground",
      );
    });

    it("treats the custom font-sizes as one group", () => {
      // The other half of registering them: they have to conflict with each
      // other, or a component that overrides a size ends up with both.
      expect(cn("text-md", "text-2xs")).toBe("text-2xs");
      expect(cn("text-2xs", "text-micro")).toBe("text-micro");
    });

    it("treats a custom font-size and a built-in one as one group", () => {
      expect(cn("text-2xl", "text-micro")).toBe("text-micro");
      expect(cn("text-micro", "text-2xl")).toBe("text-2xl");
    });

    it("treats the one custom shadow as part of the shadow group", () => {
      expect(cn("shadow-sm", "shadow-modal")).toBe("shadow-modal");
    });
  });

  describe("the behaviour every use depends on", () => {
    it("still resolves an ordinary conflict last-wins", () => {
      expect(cn("p-2", "p-4")).toBe("p-4");
    });

    it("keeps classes from different groups", () => {
      expect(cn("flex", "p-4")).toBe("flex p-4");
    });

    it("drops falsy values, which is how conditional classes are written", () => {
      expect(cn("flex", false && "hidden", undefined, null, "p-4")).toBe(
        "flex p-4",
      );
    });
  });
});
