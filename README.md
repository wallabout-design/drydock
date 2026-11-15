# editor

`@wallabout-design/editor` is the client-side editor for [wallabout design](https://wallabout.design) sites. Staff use it to edit the texts and lists on their own site.

The package is in progress: the build, tests and release are in place, and the editing features are being built. Sites install it by tag:

```sh
npm install github:wallabout-design/editor#v0.1.0
```

Licensed under the MIT licence (see `LICENSE`). The design is `standards/content-editing.md` in `wallabout-design/standards`.

## D1 store

`d1Store(db, { content })` from `@wallabout-design/editor/server` keeps content in a site's D1. Copy `node_modules/@wallabout-design/editor/migrations/0001_content.sql` into the site's own migrations folder (with its next number) and apply it like any other; a new list or field needs no migration.
