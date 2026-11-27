---
name: release-checklist
description: Release checklist for Tripboard (danielnoam/tripboard): a branch and PR per change, a changes/<branch>.md note (folded into CHANGELOG.md by tools/release.js), CLI/MCP coverage, the notes files (ARCHITECTURE.md, TODO.md, DROPPED.md), English and Hebrew, the tests including the browser UI test, screenshots for the gallery, merging on green, test builds by label and checking the runs. Use before shipping any change to Tripboard.
---

# Tripboard release checklist

Adapted from Waypage's. Every change that reaches `main` leaves the
version, the change notes and the notes files in step with it.

## 1. A branch, and whether this PR releases

- `git pull --ff-only`, then a branch named for the change:
  `fix/<what>`, `feature/<what>` or `docs/<what>`.
- A merge releases only if it bumps the version. By default a PR doesn't;
  Daniel asks for a release, or a single fix that should reach phones
  now does it in the same PR.
- To bump: `node tools/release.js x.y.z` (feature: minor, fix: patch,
  always above the latest `app-v*` release). It changes `APP_VERSION` in
  `src/app.js`, every `?v=` in `index.html` and `CACHE` in `sw.js`, and
  folds every `changes/*.md` into a dated CHANGELOG.md entry, deleting
  the notes.

## 2. Change notes, not CHANGELOG.md

Anything a person can notice gets `changes/<branch>.md` (slashes become
hyphens) under `### Added` / `### Changed` / `### Fixed` / `### Removed`,
in plain words a person using it would use (changes/README.md). Never
edit CHANGELOG.md by hand. These notes are also what the app shows as
"Not released yet" in Settings › About › Changelog on test and
unreleased builds, so write them for the person reading them there.

## 3. The app's rules (CONTRIBUTING.md, "Rules for every change")

- **CLI and MCP**: a new field, sheet, Settings page, action or repo file
  has its tool in `cli/tools.js` and a line in `cli/coverage.js` (or a
  `device:` reason only if it never leaves the device).
  `test/coverage.test.js` fails until it does. After changing `cli/` or a
  `src/` file the server loads, run `node tools/server-copy.js`.
- **English and Hebrew**: words go through `i18n.t` / `data-t` with a
  gender-neutral line in `src/lang/he.js`; CSS uses logical sides.
- **Security and privacy**: say any trade-off plainly in the PR and in
  ARCHITECTURE.md's Trade-offs. The CSP stays strict.
- **Ask first**: a new look or reworked screen is shown to Daniel
  (screenshots in the gallery) and waits for his OK before it merges.
- A file added to or removed from the app goes in or out of `sw.js`'s
  `ASSETS` (`test/app.test.js`, and `tools/build-www.js` fails if
  `index.html` loads a file it lacks).
- Shared files (`src/keel/`, `server.js`, keel's `tools/`, `RULES.md`)
  are changed in keel, then synced with `node tools/keel-sync.js v<x.y.z>`
  in a PR of their own.

## 4. Notes files (one home per entry)

- **ARCHITECTURE.md**: a file added, removed or renamed, or a flow
  changed, in the same commit (`test/docs.test.js` checks every file is
  named). A trap that would bite again goes under Traps.
- **TODO.md**: remove what this completes, add follow-ups.
- **DROPPED.md**: what Daniel decided against, with his reason.
- **Why**: in the commit message and the PR description.

## 5. Verify

- `node test/run-all.js` (`npm test`). `test/ui.test.js` opens every
  screen at phone and desktop width in English and Hebrew; it needs
  Playwright, which CI installs. After a failure, re-run only the files
  that failed while fixing.
- For UI work: `node server.js`, then screenshots of every changed page
  at phone (390 px) and desktop (1280 px) width, English and Hebrew, with
  no console errors. They go in the gallery artifact
  (https://claude.ai/artifact/L6hDngGoaGY1uyTwRg13eW), newest section
  first, not as attachments.
- Say what couldn't be checked without a phone (installing, sharing into
  the app, native plugins).

## 6. PR, merge on green

- Open the PR (assign Daniel). `auto-merge.yml` turns on auto-merge
  (squash) for Daniel's own PRs that open ready, once `AUTOMERGE_TOKEN`
  is set, so open unfinished work, or anything waiting for his OK on a
  new look, as a **draft**.
- Otherwise merge it yourself once Tests is green. If `main` moved, merge
  it into the branch; never force-push `main`.
- To try a change on a phone first, label the PR `test` (or
  `test-android`) and say the build is on the `test-<branch>` pre-release.

## 7. Check the runs

After the merge, check that `pages.yml` deployed and `android.yml`
built. Every merge to main builds the APK: a release when `APP_VERSION`
is new, and the unreleased channel's build either way, which Pages serves
under `unreleased/`. Windows, iOS and Linux build only when run by hand.
