---
title: gesture-audio Agent Guide
updated: 2026-08-24
status: current
domain: technical
---

# gesture-audio Agent Guide

`@jbdevprimary/gesture-audio` is a gesture-gated Tone.js bus graph + Howler
sprite resolver + preferences bridge for browser audio. It solves one
specific problem: browsers refuse to resume a `Web Audio` context until a
person interacts with the page, and a partial unlock (context resumes while
sample loading or preference hydration fails) is worse than no unlock at all.
The package treats unlock and application bootstrap as one concurrent-safe,
retryable transaction. It does not define cue names, gameplay policy, or a
persistence framework — those stay in the consuming application.

Use Node 22+ and pnpm (pinned via `packageManager` in `package.json`; use
`corepack enable` rather than a global pnpm install).

## Source of truth

- **`docs-site/` (Astro Starlight) is the canonical human/AI-facing docs
  site**, deployed to `https://jonbogaty.com/gesture-audio/` on every push to
  `main` by `cd.yml`. It builds `llms.txt`, `llms-small.txt`, and
  `llms-full.txt` via `starlight-llms-txt` — read those first when answering
  questions about the public API from outside this repo. Build it locally
  with `pnpm docs:build`; iterate with `pnpm docs:dev`.
- `docs/*.md` (architecture, releasing, troubleshooting) are the **hand-authored
  source** the Starlight guide pages under `docs-site/src/content/docs/guides/`
  are kept in sync with. `scripts/check-docs.mjs` validates relative links in
  the root-level markdown files (README, CONTRIBUTING, SECURITY, CHANGELOG,
  `examples/README.md`, `docs/*.md`) — those files also ship inside the
  published npm tarball via `package.json#files`, so every relative link and
  image reference in them must resolve both inside this repo and inside an
  installed copy of the package.
- `src/index.ts` is the only supported runtime import path; it re-exports the
  full public API from `buses.ts`, `init.ts`, `preferences-bridge.ts`, and
  `sprite-resolver.ts`. `src/build-tools/index.ts` is a **separate** entry
  point (`@jbdevprimary/gesture-audio/build-tools`) so Node-only filesystem
  code never enters a browser bundle — never re-export it from the runtime
  entry point.

## Layout

Four single-responsibility modules, no application singleton:

1. `src/init.ts` — the gesture-gated start transaction. `Tone.start()` and
   caller bootstrap either both complete or the next gesture may retry.
2. `src/buses.ts` — continuous Tone.js signal flow. The first name passed to
   `buildBuses()` is the master bus; every bus routes through a -1 dBFS
   limiter before device output. `muteBus`, `duckBus`, and focus-loss mute
   (via the preferences bridge) are independently reversible layers over the
   same effective-gain calculation — see `applyEffectiveGain` in `buses.ts`.
3. `src/sprite-resolver.ts` — Howler sample sheets. Validates and flattens
   flat or file-grouped sprite maps, creates one `Howl` per file, tracks
   active sound IDs by target bus so live volume/mute changes reach loops and
   long samples, not just future playback.
4. `src/preferences-bridge.ts` — translates persisted integer percentages
   (0-100) and mute policy into the two runtime engines above without owning
   persistence itself. Read/update transactions are serialized per store so
   concurrent slider drags cannot overwrite a newer value with a stale one.

Full invariants and error policy: `docs-site/src/content/docs/guides/architecture.md`
(mirrors `docs/architecture.md`).

## Testing

- `tests/*.test.ts` mirror `src/*.ts` one-to-one; `tests/verify-sprites.test.ts`
  uses real temporary audio when `ffmpeg`/`ffprobe` are on `PATH` and falls
  back to structural-only checks when they are not.
- `pnpm coverage` enforces coverage thresholds (see `vitest.config.ts`). Do
  not add exclusions for ordinary error paths — test observable behavior
  through the public API, matching the existing test files' style.
- `pnpm verify` is the full gate CI runs: lint, typecheck, coverage, both
  module builds (ESM + CJS), doc link-check, packed-import smoke test
  (`scripts/smoke-imports.mjs`), and package metadata validation (`publint`
  + `attw --pack .`). Run it before any commit that touches `src/`, `docs/`,
  or the package's public surface.

## Workflows

`ci.yml` → `release.yml` → `cd.yml`, each scoped narrowly:

- **`ci.yml`** — `verify` (lint/typecheck/coverage/build/docs-link-check on
  ubuntu with `ffmpeg` installed), `compatibility` (Node 22/24/26 ×
  ubuntu/windows/macos), `docs-site` (Astro build, uploaded as a Pages
  artifact for reuse). Runs on every PR and push to `main`.
- **`release.yml`** — `release-please` opens/updates the release PR from
  Conventional Commit PR titles on `main`; merging it publishes to npm with
  provenance. See `docs-site/src/content/docs/guides/releasing.md`.
- **`cd.yml`** — builds and deploys `docs-site/` to this repo's own GitHub
  Pages (`build_type: workflow`) on every push to `main`. GitHub resolves
  `jonbogaty.com/gesture-audio/` for this repo automatically because the org
  apex repo `jbcom/jbcom.github.io` owns the verified `jonbogaty.com` custom
  domain — no cross-repo push is involved.

All GitHub Actions are pinned to exact commit SHAs (with a `# vX.Y.Z` comment)
per the fleet's supply-chain convention. Resolve a new SHA with `gh api
repos/<owner>/<repo>/git/ref/tags/<tag>` rather than trusting training data or
hand-typing one.

## Conventions

- Conventional Commits are the release contract — PR titles land on `main`
  via squash merge and directly drive `release-please`'s version bump and
  changelog. Use `feat!:` or a `BREAKING CHANGE:` footer only for an
  intentional public API break.
- `pnpm-workspace.yaml` lists two members: `.` (the library) and `docs-site`
  (the Astro site). A single root `pnpm-lock.yaml` covers both — there is no
  separate `docs-site/pnpm-lock.yaml`.
- Biome (`biome.json`) is the only linter/formatter; its `files.includes`
  covers `src/**`, `tests/**`, `scripts/**`, and `docs-site/{*.mjs,*.json,src/**/*.ts}`.
  `docs-site/src/content/**/*.md(x)` is intentionally excluded (Starlight
  content, not code).
