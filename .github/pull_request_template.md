<!--
Title becomes the squash commit subject, so write it as one — imperative, no
issue number, no "PR:" prefix. The body below becomes the commit message.
-->

## What changed

<!-- One paragraph. What a reader of `git log` needs to know. -->

## Why

<!-- The problem, not the patch. Link the issue rather than restating it. -->

Closes #

## Checklist

Delete the lines that do not apply; leave the ones that do, ticked.

- [ ] `/code-review` run — required for anything touching code, skipped for markdown-only
- [ ] Screenshots below, desktop and 375px, for any change that moves pixels
- [ ] Migration SQL read before committing — it is forward-only, there is no `down`
- [ ] New table added → the cross-org isolation test extended to cover it (#27)
- [ ] New environment variable → in `src/lib/env-schema.mts` *and* `.env.example`, and no
      `NEXT_PUBLIC_` prefix on anything secret
- [ ] Money handled as integer cents

## Screenshots

<!-- Desktop and 375px. Delete this section if nothing visual changed. -->
