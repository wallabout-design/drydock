# drydock

`@wallabout-design/drydock` is the on-site toolkit for [wallabout design](https://wallabout.design) sites. It has two features, each with its own permissions:

- **Editing** (the package root, `./server`, `./react`, `./astro`): signed-in staff edit the texts and lists on their own site. The design is `standards/content-editing.md` in `wallabout-design/standards`.
- **Feedback** (`./feedback`, `./feedback/react`, `./feedback/reserve.css`): a hidden "send feedback" link for reviewers who opt in with `?feedback`. See [`docs/feedback.md`](docs/feedback.md); the design is `standards/feedback.md`.

The plan for both (one panel, pluggable stores and feedback delivery) is `standards/drydock.md`.

drydock was `wallabout-design/editor` up to v0.3.0; `wallabout-design/feedback` (up to its v0.3.0) was merged in with its history. Sites install it by tag:

```sh
npm install github:wallabout-design/drydock#vX.Y.Z
```

A page that imports only `@wallabout-design/drydock/feedback` bundles none of the editing code: the entry points are separate and the package has no side effects.

Licensed under the MIT licence (see `LICENSE`).

## Moving a site from `editor` and `feedback`

The code is the same as editor v0.3.0 and feedback v0.3.0; only the names change. In one PR per site:

1. In `package.json`, replace `@wallabout-design/editor` and `@wallabout-design/feedback` with `"@wallabout-design/drydock": "github:wallabout-design/drydock#vX.Y.Z"`.
2. Rename imports: `@wallabout-design/editor…` becomes `@wallabout-design/drydock…` (the subpaths are the same), `@wallabout-design/feedback` becomes `@wallabout-design/drydock/feedback`, and `@wallabout-design/feedback/react` and `/reserve.css` move under `@wallabout-design/drydock/feedback/`.
3. Change the content type's `declare module '@wallabout-design/editor'` to `declare module '@wallabout-design/drydock'`, or every key is a plain `string` again.
4. In `.github/workflows/content-merge.yml`, use `wallabout-design/drydock/.github/workflows/content-merge.yml@vX.Y.Z`, with the same tag as the package.

## Scans

`npm run verify` also runs two security scans, and CI's `scan` job runs the same commands:

- `npm run scan:secrets`: `gitleaks` over the commits your branch adds to `origin/main`. A false alarm goes in `.gitleaksignore`, with a comment saying what it is.
- `npm run scan:deps`: `osv-scanner` over `package-lock.json`. It fails on a vulnerability rated high or critical (CVSS 7.0 or more) or with no rating. An ignore goes in `osv-scanner.toml` with a reason and an end date.

Install both tools locally with `brew install gitleaks osv-scanner`. CI installs release binaries at the exact versions in `scripts/ci-install-scan-tools.sh` and checks their SHA-256 first.

## D1 store

`d1Store(db, { content })` from `@wallabout-design/drydock/server` keeps content in a site's D1. Copy `node_modules/@wallabout-design/drydock/migrations/0001_content.sql` into the site's own migrations folder (with its next number) and apply it like any other; a new list or field needs no migration.

## Writing a store

A store keeps a site's content and its changes somewhere. It is an object that implements `Store` (`src/core/store.ts`) with six methods: `read`, `submit`, `approve`, `reject`, `undo` and `list`. The rules every store keeps:

- It refuses a stale change whole: if anything the editor last saw has moved on, nothing is applied.
- An undo is a new live change that puts the content back; the change it undid stays in the history.
- It never trusts the browser's checks. It validates every operation itself.

`@wallabout-design/drydock/testing` exports the contract every store must pass. It needs `vitest` (an optional peer dependency). In the store's own test file:

```ts
import { storeContract } from '@wallabout-design/drydock/testing';

storeContract(() => myStore());
```

`d1Store` (`test/d1-store.test.ts`) and the git store (`test/git-store.test.ts`) are worked examples.

## Uploaded images

An image field can hold an upload. The original is kept untouched in the site's R2 bucket, and the sizes a page needs are made from it by the site's Worker, only from `/admin` when staff save, with Cloudflare's `IMAGES` binding and its free allowance. The public route only reads files that exist, so a visitor can't spend the allowance. Sizes are WebP, and also AVIF where the size has at most 1 million pixels (the images service answers WebP above that, so a larger size has no AVIF file and no AVIF address on the page). `/media/` answers an AVIF address whose AVIF file is not there with the WebP of the same size (`image/webp`, cached for an hour), so sizes made before AVIF existed, and sizes the service can't make as AVIF, still show. The rebuild page counts a size missing until its AVIF is made, and a size the service can't make as AVIF gets a marker so it isn't asked for again.

1. Bind the bucket and the images service in `wrangler.jsonc`:

   ```jsonc
   "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "<site>-media" }],
   "images": { "binding": "IMAGES" }
   ```

2. Give the editor both: `createEditor({ …, uploads: { bucket: env.MEDIA, images: env.IMAGES } })`. Without `uploads`, an item holding an uploaded image is refused on save with a message saying so.
3. Let the Worker answer the site's media paths, before anything else answers them: `if (pathname.startsWith('/media/')) return serveMedia(request, env.MEDIA)` (`serveMedia` is exported from `@wallabout-design/drydock/server`). `/media/*` must reach the Worker, so it must not be left to static assets (add it to `run_worker_first`). It only reads `renditions/…`, never transforms, and answers 404 for anything else, every `originals/` path included.

Things to know:

- Each image view is one Worker request. The Workers free plan allows 100,000 a day, which is the ceiling.
- The images service makes 5,000 new transformations a month for each account. Past that, saving an image answers with a sentence saying the allowance is used up; sizes already made keep working. A site moving many images at once should count: 950 images at two widths is about 1,900.
- Originals are up to 15 MB, JPEG, PNG or WebP (decided by the file's first bytes). Originals no item uses stay in the bucket; nothing cleans them up yet.
- The form shows a chosen photo before it is uploaded from a `blob:` address. The list page allows that itself. On the edit view the form opens over the site's own page, so a site with a content security policy needs `blob:` in its `img-src` there (and `'self'`, for stored images), or the preview stays empty.
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
    uses: wallabout-design/drydock/.github/workflows/content-merge.yml@vX.Y.Z # the tag the site installs
    with:
      mode: auto # the same mode as the editor's `mode` setting
      declaration: src/content.ts # exports the result of defineContent as `content`
```

Notes:

- `declaration` is a module that runs under plain Node 24 and imports nothing from Astro, React or a Worker. It must be the same declaration the editor uses.
- Use the same tag as the installed package: the workflow runs the package's `dist/merge/cli.js` from `node_modules`. The site needs `.nvmrc` and a lockfile, as for `ci`.
- Other inputs: `branch-prefix` (default `content-edit/`, the store's `branchPrefix`), `test-check` (default `test`), `base-branch` (default: the default branch), `editor-path`.
- GitHub lets the workflow's token merge the pull request when `test` is the only required check and it passed. A branch rule needing a person's review would stop it.
