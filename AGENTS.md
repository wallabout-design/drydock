# Agent guidelines

`@wallabout-design/editor` is the package that lets client staff edit texts and lists on their own wallabout site. The design is `standards/content-editing.md` in `wallabout-design/standards`; read it first.

## Rules

- The core has no framework or Worker imports. It takes what it depends on (storage, clock, `fetch`) as arguments.
- Sites install by tag: `github:wallabout-design/editor#vX.Y.Z`. Merging to `main` changes no site.
- `dist/` is committed, because sites install it straight from git. Rebuild it with `npm run build` and commit it with the change.

## Checking a change

Run `npm run verify` (type check, build, unit tests) before pushing. CI runs the same command, then fails if `dist/` differs from `src/`.

## Releases

Never tag a release or bump a version unless the issue asks. The steps are in the README ("release").
