# feedback

Hidden "send feedback" link for wallabout sites: a prefilled email with the page, viewport, build and highlighted text. Exported from `@wallabout-design/drydock/feedback` (it was the separate package `@wallabout-design/feedback` up to v0.3.0).

Ordinary visitors never see it. A visit with `?feedback` turns it on for that browser (stored as `localStorage` `feedback=1`), and `?feedback=off` turns it off (so do `0`, `false` and `no`; any other value turns it on). The link is a `mailto:` to `feedback@wallabout.design` with the subject `[<siteId>] <path> #<id>`, where `<id>` is a fresh 4-character code on each click (no look-alike characters), so every note gets its own thread in the inbox and can be named in a reply. It quotes any highlighted text (up to 500 characters, and still counted for 3 s after the selection clears) and adds the URL, viewport, device pixel ratio, browser and build (from `<meta name="build">`). Nothing is sent until the reviewer sends the email. The feedback routine is described in `standards/feedback.md` in `wallabout-design/standards`.

## install

```sh
npm install github:wallabout-design/drydock#vX.Y.Z
```

## use

Any site, from a bundled script (not an inline one, so a CSP that blocks inline scripts is fine):

```html
<a href="mailto:feedback@wallabout.design" hidden data-feedback-link>send feedback</a>
```

```ts
import { initFeedbackLink } from '@wallabout-design/drydock/feedback';

const link = document.querySelector<HTMLAnchorElement>('[data-feedback-link]');
if (link) initFeedbackLink(link, { siteId: 'wallabout' });
```

Nothing runs at import time. `initFeedbackLink` returns a function that removes its listeners. Pass `address` to send notes somewhere else.

The link opens the mail app from the same tab. Don't give it `target="_blank"`: some browsers block a `mailto:` in a new tab as a pop-up. `initFeedbackLink` removes the attribute from older markup anyway.

React (React is an optional peer dependency):

```tsx
import { FeedbackLink } from '@wallabout-design/drydock/feedback/react';

<FeedbackLink siteId="rr" className="feedback-link" />;
```

It renders `<a hidden data-feedback-link>send feedback</a>` and calls `initFeedbackLink` in `useEffect`, so it's safe under StrictMode. Style it through `className` with the site's own tokens. Remember the `[hidden] { display: none }` rule if the class sets `display`.

## reserving space at the bottom of the page

The package ships no styles for the link itself. Sites usually fix it at the bottom right of the viewport, where it covers whatever the footer has in that corner once you scroll to the bottom. Import the optional `reserve.css` to keep that corner clear:

```ts
import '@wallabout-design/drydock/feedback/reserve.css';
```

While the link is shown (any `[data-feedback-link]` without `hidden`, which both the plain markup and `FeedbackLink` render), it pads the bottom of `<body>` by `--feedback-reserve`, 64px by default: the link's height plus its offset from the bottom. If the site's link is taller or sits higher, set the variable, for example `:root { --feedback-reserve: 80px; }`. Ordinary visitors never see the link, so their pages are unchanged.

Import it whenever the link is fixed over the page. The rule keys on the `hidden` attribute, so keep `[hidden] { display: none }` working: if the site's link styles set `display`, add that rule too, or the link shows for every visitor while no space is reserved.

## develop

Feedback's tests run with the rest of the package (`npm run verify`, see `AGENTS.md`): `test/feedback-mailto.test.ts` and `test/feedback-react.test.ts` in the unit run, and `e2e/feedback-link.e2e.ts` in the browser run, on the fixture pages in `e2e/feedback-fixture/` served by `e2e/feedback-server.mjs` with a CSP that blocks inline scripts.
