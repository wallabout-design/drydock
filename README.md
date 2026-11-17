# editor

`@wallabout-design/editor` is the client-side editor for [wallabout design](https://wallabout.design) sites. Staff use it to edit the texts and lists on their own site.

The package is in progress: the build, tests and release are in place, and the editing features are being built. Sites install it by tag:

```sh
npm install github:wallabout-design/editor#v0.2.0
```

Licensed under the MIT licence (see `LICENSE`). The design is `standards/content-editing.md` in `wallabout-design/standards`.

## D1 store

`d1Store(db, { content })` from `@wallabout-design/editor/server` keeps content in a site's D1. Copy `node_modules/@wallabout-design/editor/migrations/0001_content.sql` into the site's own migrations folder (with its next number) and apply it like any other; a new list or field needs no migration.

## Uploaded images

An image field can hold an upload. The original is kept untouched in the site's R2 bucket, and the sizes a page needs are made from it by the site's Worker, only from `/admin` when staff save, with Cloudflare's `IMAGES` binding and its free allowance. The public route only reads files that exist, so a visitor can't spend the allowance. Sizes are WebP.

1. Bind the bucket and the images service in `wrangler.jsonc`:

   ```jsonc
   "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "<site>-media" }],
   "images": { "binding": "IMAGES" }
   ```

2. Give the editor both: `createEditor({ …, uploads: { bucket: env.MEDIA, images: env.IMAGES } })`. Without `uploads`, an item holding an uploaded image is refused on save with a message saying so.
3. Let the Worker answer the site's media paths, before anything else answers them: `if (pathname.startsWith('/media/')) return serveMedia(request, env.MEDIA)` (`serveMedia` is exported from `@wallabout-design/editor/server`). `/media/*` must reach the Worker, so it must not be left to static assets (add it to `run_worker_first`). It only reads `renditions/…`, never transforms, and answers 404 for anything else, every `originals/` path included.

Things to know:

- Each image view is one Worker request. The Workers free plan allows 100,000 a day, which is the ceiling.
- The images service makes 5,000 new transformations a month for each account. Past that, saving an image answers with a sentence saying the allowance is used up; sizes already made keep working. A site moving many images at once should count: 950 images at two widths is about 1,900.
- Originals are up to 15 MB, JPEG, PNG or WebP (decided by the file's first bytes). Originals no item uses stay in the bucket; nothing cleans them up yet.
- A preview deployment shows uploaded images only if its Worker can read the production bucket (bind the same bucket there).

## Rebuild images

Sizes are made when staff save an item. When a site later changes a field's `widths`, `full` or `aspect`, admins open `/admin/images` (only when `uploads` is given). For each list with an image field it counts the sizes the stored items need and those not made yet, and one button makes the missing ones from the browser, one request each, with a stop button. When the month's allowance is used up (429) it stops and keeps its place; a later visit finds what is still missing, so the run can be resumed next month. An item whose crop no longer fits a changed `aspect`, or whose original is gone, is listed with a link to its form (`/admin/lists/<name>?edit=<id>`), not guessed.

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
