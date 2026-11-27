# Contributing to Tripboard

The rules for everyone who works on Tripboard, people and Claude sessions
alike. CLAUDE.md adds only what is specific to Claude.

## Getting started

```sh
node server.js          # http://localhost:5173
node test/run-all.js    # the whole test suite
```

Read ARCHITECTURE.md (the map), TODO.md (what's planned), DROPPED.md (what was turned down) and
CHANGELOG.md before proposing anything, so nothing shipped or turned down
comes back.

## Decisions that are already made

- **No build step, no dependencies.** Plain files, served as they are.
  Anything vendored goes under `src/vendor/` with its licence beside it.
  `package.json` is only the native builds' tools (Capacitor, Tauri); the
  app never loads anything from it.
- **One set of files everywhere.** The web app, the phone apps and the
  desktop app are the same files: `tools/build-www.js` copies sw.js's
  ASSETS into `www/` (phones) or `www-desktop/` (desktop). What differs
  by platform is decided in keel's platform.js, never sniffed elsewhere.
- **Shared files come from keel.** `src/keel/`, `server.js` and the
  `tools/` keel lists are never edited here (`test/keel.test.js` fails if
  they are).

## Rules for every change

**Security and privacy, as far as it can go.** For every change ask what
it sends, to whom, and what a page, file or other site could do with it.
Least access, nothing leaves the device unless the person turned it on,
and any trade-off is said plainly and written in ARCHITECTURE.md's
Trade-offs. The page's Content-Security-Policy stays strict
(`test/csp.test.js`): no inline script, handler or style attribute.

**Every platform.** It works in a browser, in the phone apps and in the
desktop app, at phone and desktop width. A native plugin or permission is
added in `package.json` and `tools/android-manifest.js` /
`tools/ios-project.js` / `src-tauri/`, with its reason beside it.

**Design.** Colours are tokens in `src/styles.css`, every theme passes
WCAG AA (`test/contrast.test.js`), touch targets are 44 px, and every
animation has a reduced-motion answer. Moves go through keel's motion
(`Tripboard.motion`), which turns each into a short fade under reduced
motion; a CSS transition uses its `--spring-*` variables.

**Ask first for big things.** A new look, a reworked screen or a big
change is shown or explained to Daniel first and waits for his OK.

**Every language.** Tripboard is in English and Hebrew (right to left).
Words a person sees go through `i18n.t("...")` / `i18n.tn(...)` in JS or
`data-t` / `data-t-attr` in index.html, keyed by the English, with a
line in `src/lang/he.js` (`test/i18n.test.js` fails without it). Hebrew
copy uses gender-neutral forms. CSS uses logical sides (`inset-inline-start`,
`margin-inline-end`, `text-align: start`), not left/right, except the
map's place card, which doesn't flip (the map's buttons and credit do). Dates and numbers go through Intl
with `i18n.lang`.

**Every change works from the CLI and MCP.** Anything a person can do or
see in the app, a chat can do through `cli/` too: a new field, sheet,
Settings page, action or file in the sync repo ships with its command and
tool in the same pull request (`cli/tools.js` makes both, `cli/core.js`
does the work, `test/cli.test.js` tests it, `cli/README.md` lists it).
`cli/coverage.js` maps every part of the app to the tools that cover it,
and `test/coverage.test.js` fails when something new isn't there. Only
what never leaves the device (keys, providers, theme, offline maps) gets
a "device:" reason instead of a tool. Tools are added, never renamed or
removed (`PUBLISHED` in coverage.js). The sharing server serves the same tools
from its own copies (server/app/, so server/ stands alone for its Deploy
to Cloudflare button): after changing `cli/` or a `src/` file they load,
run `node tools/server-copy.js` (`test/server.test.js` fails until then).

## Keeping the notes files right

- A change a person can notice adds a note in `changes/` (see its
  README). Only a release writes CHANGELOG.md.
- A "no" becomes an entry in DROPPED.md with the reason.
- ARCHITECTURE.md changes in the same commit as the code it describes.
- Why goes in the commit message and the PR description.

## Versions and releases

- `main` takes pull requests only, merged when the Tests check is green.
- A merge is a release only when it bumps the version:
  `node tools/release.js x.y.z` changes APP_VERSION in `src/app.js`, every
  `?v=` in `index.html` and `CACHE` in `sw.js`, and folds `changes/` into
  CHANGELOG.md. New feature: minor; fix: patch.
- The web copy is GitHub Pages from `main` (`pages.yml`, after the
  tests): every merge updates it.
- Every merge to main builds the APK (`android.yml`). With a new
  version it publishes the release `app-v<version>`; either way it is the
  unreleased channel's build, served from the site's `unreleased/`
  (keel's tools/unreleased.js) and offered by Settings › About › Updates
  on phones that picked Unreleased builds. The Windows app
  (`desktop.yml`), iOS (`ios.yml`) and Linux build only when run by hand.
- The apps ship CHANGELOG.md with what's in `changes/` on top as
  `## [Unreleased]` (tools/build-www.js, keel's withPending), shown as
  "Not released yet" in Settings › About › Changelog. The web copy shows
  the committed file.
- A pull request labelled `test` (or `test-android`, `test-ios`,
  `test-desktop`, `test-linux`) gets a test build on the pre-release
  `test-<branch>`; the label coming off or the PR closing removes it.
