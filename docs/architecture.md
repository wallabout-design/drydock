# Architecture

How `@wallabout-design/drydock` fits together, as the code does it today. The plan is `standards/drydock.md` in `wallabout-design/standards`. Paths are relative to this repo.

## The pieces

```mermaid
flowchart LR
  subgraph Browser["Browser, on the site's pages"]
    Dock["dock launcher and panel<br/>src/dock/dock.ts"]
    FbSec["feedback section<br/>src/dock/feedback-section.ts"]
    EdSec["editing section<br/>src/dock/editing-section.ts"]
    Staff["staffStatus<br/>src/dock/staff.ts"]
    Transport["mailtoTransport and submitTransport<br/>src/feedback/transports.ts"]
    EditView["edit view, list page, images page<br/>src/editor/*.js"]
    Dock --> FbSec
    Dock --> EdSec
    EdSec --> Staff
    FbSec --> Transport
  end

  subgraph Worker["The site's Worker"]
    Editor["createEditor owns /admin/*<br/>src/server/editor.ts"]
    Feedback["createFeedback owns /feedback/api/*<br/>src/server/feedback.ts"]
    Access["Access token check, editor and admin lists<br/>src/server/access.ts"]
    Media["serveMedia: /media/*<br/>src/server/uploads.ts"]
    Editor --> Access
    Feedback --> Access
  end

  CFAccess(["Cloudflare Access"])
  subgraph Stores["Stores: src/core/store.ts"]
    Git["git store<br/>src/stores/git"]
    D1["D1 store<br/>src/stores/d1"]
  end
  subgraph Sinks["Sinks: Sink in src/server/feedback.ts"]
    GhSink["githubIssuesSink<br/>src/feedback/sinks/github.ts"]
    Other["email sink, D1 inbox sink<br/>not built yet"]
  end
  GitHub[("GitHub: repo, pull requests, issues")]
  GhAuth["resolveGitAuth: GitHub App or token<br/>src/stores/git/auth.ts"]
  R2[("R2 originals and renditions")]
  Images["Images binding"]
  MergeWf["content-merge workflow<br/>.github/workflows/content-merge.yml<br/>src/merge/cli.ts"]
  Mail["mailto: feedback@wallabout.design"]

  Staff -->|"GET /admin/api/me"| CFAccess
  EditView -->|"POST /admin/api/changes"| CFAccess
  Transport -->|"POST /feedback/api/notes"| CFAccess
  Transport -.->|"signed out"| Mail
  CFAccess --> Editor
  CFAccess --> Feedback
  Editor --> Git
  Editor --> D1
  Editor --> R2
  Editor --> Images
  Media --> R2
  Feedback --> GhSink
  Feedback -.-> Other
  Git --> GhAuth
  GhSink --> GhAuth
  GhAuth --> GitHub
  GhSink -->|"issue labelled feedback"| GitHub
  Git -->|"content-edit/* pull request"| GitHub
  GitHub -->|"workflow_run after ci"| MergeWf
  MergeWf -->|"squash merge, or label"| GitHub
```

Entry points (`package.json` `exports`):

| Entry point | What | Side |
| --- | --- | --- |
| `.` | `defineContent`, reading content, the change model, the in-memory store | build and server |
| `./server` | `createEditor`, `createFeedback`, `identify`, `serveMedia`, `githubIssuesSink`; re-exports both stores until 1.0 | Worker |
| `./stores/git`, `./stores/d1` | One store each | Worker |
| `./react`, `./astro`, `./astro/*.astro` | Rendering texts, lists and images | pages |
| `./dock`, `./dock/react`, `./dock.css` | The launcher and panel, with `feedbackSection` and `editingSection` | public pages |
| `./feedback`, `./feedback/react`, `./feedback/reserve.css` | Capture, transports and the hidden link; imports nothing from the rest of the package | public pages |
| `./editor.js`, `./item-form.js`, `./editor.css` | The edit view's files, which `createEditor` also serves under `/admin` | `/admin` |
| `./testing` | `storeContract`, `sinkContract` | tests |

Not built: `emailSink` and `d1InboxSink` (named in the design). Images are handled in drydock: originals go to R2 and sizes are made by the `IMAGES` binding, only on a staff save (`src/server/uploads.ts`, `src/core/image.ts`).

## Flow a: a staff edit goes live

```mermaid
sequenceDiagram
  actor Staff
  participant Page as Edit view (browser)
  participant W as Worker: createEditor
  participant S as Git store
  participant GH as GitHub
  participant CI as Site ci workflow
  participant M as content-merge workflow
  participant D as Site deploy

  Staff->>Page: change a text, Save
  Page->>W: POST /admin/api/changes (ops)
  W->>W: identify (Access token, then lists), can(edit)
  W->>W: validate every op against the declaration
  W->>S: submit(ops, mode)
  S->>GH: commit and pull request on content-edit/*
  W-->>Page: change, state waiting
  GH->>CI: pull request checks (test)
  CI-->>M: workflow_run completed
  M->>GH: read files and check runs through the API
  alt only content files, values valid, test passed
    M->>GH: squash merge at the tested commit
    GH->>D: push to main
  else anything else
    M->>GH: label status:needs-human-review, comment why
  end
```

1. The edit view (`src/editor/editor.js`) posts the operations to `POST /admin/api/changes`; `createEditor` (`src/server/editor.ts`) calls `identify` and `can(identity, 'edit')` (`src/server/access.ts`), then validates the operations (`src/core/validate.ts`).
2. `gitStore.submit` (`src/stores/git/store.ts`) rebuilds the editor's branch `content-edit/<name>-<hash>/<date>` as the base branch plus one commit, and opens or updates one pull request (`src/stores/git/save.ts`). GitHub credentials come from `resolveGitAuth`.
3. In `review` mode the pull request carries `content:waiting-review` and an admin approves it on `/admin/changes` (`store.approve` merges it). The D1 store (`src/stores/d1/store.ts`) skips steps 2 to 4: a change is live at once.
4. In `auto` mode the site's `ci` workflow runs, then the site's `content-merge.yml` calls the reusable `.github/workflows/content-merge.yml`, which runs `dist/merge/cli.js` (`src/merge/cli.ts`, `src/merge/decide.ts`) from the default branch. It never checks out the pull request.
5. It squash-merges the tested commit only if every changed file is a content file, every value passes the declaration, and `test` passed; otherwise it labels `status:needs-human-review` and comments.
6. The deploy after the merge is the site's own, outside this repo. The store reports the change `live` once it sees the merge.

## Flow b: a reviewer's note becomes an issue

```mermaid
sequenceDiagram
  actor Reviewer
  participant P as Dock feedback section (browser)
  participant A as Cloudflare Access
  participant W as Worker: createFeedback
  participant K as githubIssuesSink
  participant GH as GitHub

  Reviewer->>P: open page with ?feedback, type a note, Send
  P->>P: captureContext, optional quoted selection
  P->>A: POST /feedback/api/notes (submitTransport)
  alt signed out (redirect, 401 or 403)
    A-->>P: opaqueredirect or 403
    P-->>Reviewer: Sign in to send, or Send by email instead (mailto with the note)
  else signed in
    A->>W: request with Cf-Access-Jwt-Assertion
    W->>W: token check, email in senders, Origin, JSON, length, 20 an hour
    W->>K: send(note, sender)
    K->>GH: POST /repos/OWNER/NAME/issues, label feedback
    GH-->>K: html_url
    K-->>W: ok, ref
    W-->>P: ok, ref
    P-->>Reviewer: Sent. Reference: issue URL
  end
```

1. `?feedback` turns the section on (`src/feedback/optin.ts`, `localStorage`); `feedbackSection({ submit: submitTransport() })` shows the note box (`src/dock/feedback-section.ts`, `src/feedback/transports.ts`).
2. `captureContext` adds URL, viewport, build and the quoted selection (`src/feedback/capture.ts`).
3. `createFeedback({ siteId, sink, senders })` answers only `POST /feedback/api/notes` (`src/server/feedback.ts`). It checks the Access token with `accessEmail`, and the email against `senders`. A refusal is an empty 403.
4. It then checks `Origin`, JSON, 16 KB, 5,000 characters, and 20 notes an hour for each sender (`memoryLimiter`, in the Worker's memory unless the site passes its own).
5. The subject is `[<siteId>] <path> #<code>`. `githubIssuesSink` (`src/feedback/sinks/github.ts`) uses it as the issue title, labels it `feedback`, and leaves the sender's address out of the body.
6. Signed out, the note stays in the box and the mailto link carries a copy (`src/feedback/mailto.ts`).

## Flow c: the dock shows "Edit this page"

```mermaid
sequenceDiagram
  participant E as Edit view (/admin)
  participant L as localStorage
  participant P as Public page: initDock
  participant S as editingSection and staffStatus
  participant W as Worker: createEditor
  participant ST as Store

  E->>L: set drydock-staff = 1 (when it loads)
  P->>S: visible()
  alt no hint
    S-->>P: false, no request
  else hint present
    S->>W: GET /admin/api/me (redirect manual)
    alt signed out
      W-->>S: redirect or 403
      S-->>P: false, dock stays empty
    else editor or admin
      opt admin only
        W->>ST: list(waiting)
        ST-->>W: changes
      end
      W-->>S: email, role, waiting
      S-->>P: true
      P->>P: render Edit this page, and N changes waiting for an admin when N is above 0
    end
  end
```

1. The edit view sets the hint (`src/editor/editor.js`, key `drydock-staff`, `src/dock/staff.ts`). It is not a permission.
2. `initDock` (`src/dock/dock.ts`) asks each section `visible()`; sections show in the order feedback, then editing; with none visible the root stays empty.
3. `staffStatus` makes the one request, only with the hint. `GET /admin/api/me` counts waiting changes for admins and reports 0 for editors (`src/server/editor.ts`).
4. `editingSection` links to `/admin/edit?page=<path>` and, for an admin with changes waiting, to `/admin/changes` (`src/dock/editing-section.ts`). The server decides what each link may do.
