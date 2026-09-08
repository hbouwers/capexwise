import { createCn } from "cn/config";

/**
 * `cn` merges Tailwind classes by resolving conflicts within a group, which
 * means it has to know which group a class belongs to. Its default table is
 * Tailwind's, and three of our type-scale steps are not in it — so `text-micro`
 * was being read as a *colour*, colliding with `text-primary-foreground`, and
 * silently dropped. A badge rendered at 13px instead of 10px with no error
 * anywhere. Registering the names is the fix; the styleguide is what caught it.
 *
 * Anything named in `docs/ui/tokens.md` that is not also a Tailwind default
 * belongs here. Adding a token to `globals.css` without adding it here produces
 * exactly that silent failure.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      // tokens.md §5 — the nine-step scale
      "font-size": [{ text: ["micro", "2xs", "md"] }],
      // tokens.md §5 — the uppercase micro-label
      tracking: [{ tracking: ["label"] }],
      // tokens.md §8 — the one shadow in the design
      shadow: [{ shadow: ["modal"] }],
    },
  },
});
