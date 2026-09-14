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
- [ ] New org-owned table → `docs/data-model.md` §9's grant to `capexwise_scoped`, `enable` and
      `force` row level security, and the policy — nothing for `capexwise_identity`
- [ ] New table of any kind → `select` for `capexwise_reader`, and its read policy if the table has
      row level security, or the nightly backup cannot read it (ADR-0010)
- [ ] New environment variable → in `src/lib/env-schema.mts` _and_ `.env.example`, and no
      `NEXT_PUBLIC_` prefix on anything secret
- [ ] Money handled as integer cents
