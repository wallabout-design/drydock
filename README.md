# editor

`@wallabout-design/editor` is the client-side editor for [wallabout design](https://wallabout.design) sites. Staff use it to edit the texts and lists on their own site.

The package is in progress: the build, tests and release are in place, and the editing features are being built. Sites install it by tag:

```sh
npm install github:wallabout-design/editor#v0.2.0
```

Licensed under the MIT licence (see `LICENSE`). The design is `standards/content-editing.md` in `wallabout-design/standards`.

## D1 store

`d1Store(db, { content })` from `@wallabout-design/editor/server` keeps content in a site's D1. Copy `node_modules/@wallabout-design/editor/migrations/0001_content.sql` into the site's own migrations folder (with its next number) and apply it like any other; a new list or field needs no migration.

## Merge content edits

With the git store in `auto` mode, a change is a pull request from a `content-edit/*` branch. A reusable workflow merges it once the tests pass, but only if every changed file is under `content/` and is the texts file or an item of a declared list, every changed value passes the site's rules again, and the `test` check passed. Anything else gets the label `status:needs-human-review` and a comment saying why. In `review` mode it does nothing.

It runs from the site's default branch after `ci` and never checks out the pull request: it reads the pull request through the API and loads the declaration from the site's own code.

A site adds one file, `.github/workflows/content-merge.yml`:

```yaml
name: content-merge
on:
  workflow_run:
    workflows: [ci]
    types: [completed]
permissions:
  contents: write
  pull-requests: write
  issues: write
jobs:
  merge:
    uses: wallabout-design/editor/.github/workflows/content-merge.yml@vX.Y.Z # the tag the site installs
    with:
      mode: auto # the same mode as the editor's `mode` setting
      declaration: src/content.ts # exports the result of defineContent as `content`
```

Notes:

- `declaration` is a module that runs under plain Node 24 and imports nothing from Astro, React or a Worker. It must be the same declaration the editor uses.
- Use the same tag as the installed package: the workflow runs the package's `dist/merge/cli.js` from `node_modules`. The site needs `.nvmrc` and a lockfile, as for `ci`.
- Other inputs: `branch-prefix` (default `content-edit/`, the store's `branchPrefix`), `test-check` (default `test`), `base-branch` (default: the default branch), `editor-path`.
- GitHub lets the workflow's token merge the pull request when `test` is the only required check and it passed. A branch rule needing a person's review would stop it.
