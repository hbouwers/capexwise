<!--
The title becomes the squash commit subject, so write it as one — a sentence,
no issue number, no "PR:" prefix. CONTRIBUTING.md has the convention.
-->

## What changed

<!-- One paragraph. What a reader of `git log` needs to know. -->

## Why

<!-- The problem, not the patch. Link the issue rather than restating it. -->

Closes #

## Screenshots

<!-- Optional. Worth attaching only for a state that is awkward to reach locally, or a
     before-and-after. Delete this section otherwise — which is most of the time. -->

---

<!--
DELETE FROM THE RULE ABOVE DOWN BEFORE MERGING.

This body becomes the squash commit message verbatim — the repository is set to
squash_merge_commit_message: PR_BODY — and a commit on `main` should read as
prose, not as a filled-in form. The checklist is for you and the reviewer, not
for `git log`.
-->

## Checklist

- [ ] `/code-review` run — required for anything touching code, skipped for markdown-only
- [ ] UI change → run the branch locally; screenshots only if a still shows something running it does not
- [ ] Migration SQL read before committing — it is forward-only, there is no `down`
- [ ] New table added → `src/server/cross-org-isolation.integration.test.ts` extended to cover
      it: named in `ORG_OWNED`, seeded on both sides, and a probe for each path that reaches it
- [ ] New environment variable → in `src/lib/env-schema.mts` _and_ `.env.example`, and no
      `NEXT_PUBLIC_` prefix on anything secret
- [ ] Money handled as integer cents
