# Tripboard

A travel planner (trip boards of places, by time, category or map; v1 in
docs/SCOPE.md), working name Tripboard, app id com.danielnoam.trips.
from-lifelog/ is LifeLog's old Travel tab, reference only. Plain HTML, CSS and JS with **no build step
and no dependencies**, started from keel's template.

## Before anything

- `git pull --ff-only` first.
- Read **CONTRIBUTING.md**: the rules for every change, the notes files,
  versions and releases. Below is only what's specific to Claude sessions.

## Shipping

- `main` takes pull requests only. Open the PR, merge it once Tests is
  green, then check the runs.
- Lines for the changelog go in `changes/<branch>.md`, never CHANGELOG.md.
- **Web only for now** (2026-11-15): desktop.yml and ios.yml run only by
  hand until Daniel wants the apps; each says how to turn it back on.
  android.yml runs on its own only for a release (a merge to main with a
  new APP_VERSION), which publishes app-v<version> for the in-app updater.
  Once on: builds are the web app, Windows and the APK by default. iOS and
  Linux only when Daniel asks (run `ios.yml`, or `desktop.yml` with Linux ticked,
  or label the PR `test-ios` / `test-linux`).
- To try a change on a phone before it merges, label its PR `test` and
  say the build is on the `test-<branch>` pre-release.
- Shared files come from keel (danielnoam/keel): change them there, then
  sync with `node tools/keel-sync.js v<x.y.z>` in its own PR.

## CLI and MCP

- Every feature or change ships with CLI/MCP support in the same PR, so
  any AI can do what the app does (CONTRIBUTING.md, "Every change works
  from the CLI and MCP"). `test/coverage.test.js` fails until it's there;
  don't satisfy it with a "device:" reason unless the thing truly never
  leaves the device.

## Branch names

- Don't use the claude/... branch the session was handed. Before the
  first commit, make a branch named for the change: fix/<what>,
  feature/<what> or docs/<what>. Push only to that branch.

## Working with Daniel

- Be direct. Push back when an idea or plan is weak, and say what was
  checked and what is a guess.
- Any security or privacy trade-off: say it plainly and write it in the
  PR description.
