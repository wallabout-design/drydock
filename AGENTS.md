# Agent guidelines

`@wallabout-design/drydock` is the package wallabout sites use on their own pages: client staff edit texts and lists (`src/core`, `src/server`, `src/editor`, `src/stores`; design `standards/content-editing.md`), and reviewers send feedback (`src/feedback`; design `standards/feedback.md`). The plan for both is `standards/drydock.md` in `wallabout-design/standards`; read it first. It was `wallabout-design/editor`, and `wallabout-design/feedback` was merged in with its history.

## Rules

- The core has no framework or Worker imports. It takes what it depends on (storage, clock, `fetch`) as arguments.
- Sites install by tag: `github:wallabout-design/drydock#vX.Y.Z`. Merging to `main` changes no site.
- `src/feedback` imports nothing from the rest of the package, so a page that only shows the feedback link bundles no editing code. Keep it that way.
- `dist/` is committed, because sites install it straight from git. Rebuild it with `npm run build` and commit it with the change.

## Checking a change

Run `npm run verify` (type check, build, unit tests, the two security scans, then the browser tests in Chromium and WebKit) before pushing. The scans need `gitleaks` and `osv-scanner` installed (`brew install gitleaks osv-scanner`); CI's `scan` job runs them, and `SKIP_SCANS=1` skips them locally. The first time, run `npx playwright install chromium webkit`; the browser tests start fixture servers from `e2e/server.mjs` over the built `dist/`. Each run picks its own free ports, so runs in different worktrees can go at the same time. `src/editor/editor.js` and `editor.css` are the browser files; `npm run build` copies them to `dist/` and into `src/server/editor-assets.ts` (generated, committed). CI runs the same command, then fails if `dist/` differs from `src/`.

## Releases

Never tag a release or bump a version unless the issue asks. The steps are in the README ("release").
