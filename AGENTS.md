---
title: gesture-audio Agent Guide
updated: 2026-08-24
status: current
domain: technical
---

# gesture-audio Agent Guide

`gesture-audio` is a gesture-gated Tone.js bus graph + Howler
sprite resolver + preferences bridge for browser audio. It solves one
specific problem: browsers refuse to resume a `Web Audio` context until a
person interacts with the page, and a partial unlock (context resumes while
sample loading or preference hydration fails) is worse than no unlock at all.
The package treats unlock and application bootstrap as one concurrent-safe,
retryable transaction. It does not define cue names, gameplay policy, or a
persistence framework — those stay in the consuming application.

Use Node 22+ and pnpm. Locally, run `mise install` (reads `.nvmrc` and
`package.json#packageManager` — see `mise.toml`) rather than a global pnpm
install or `corepack enable`. CI uses the official `actions/setup-node` and
`pnpm/action-setup` actions instead of mise, reading those same two files —
mise is a local-only convenience, not a CI dependency.

## Source of truth

- **`docs/` is the canonical Sourcey documentation site**, deployed to
  `https://jonbogaty.com/gesture-audio/` on every trusted push to `main` by
  `cd.yml`. `docs/sourcey.config.ts` defines its Sourcey navigation, branding,
  subdirectory URLs, social metadata, edit links, search, and generated
  `llms.txt` / `llms-full.txt`. Build it with `pnpm docs:build`; use
  `pnpm docs:dev` while editing. `docs/dist/` is generated and never committed.
- Root Markdown (README, CONTRIBUTING, SECURITY, CHANGELOG, examples, and
  `docs/*.md`) is hand-authored source shipped in the npm package.
  `scripts/check-docs.mjs` validates its relative links; Sourcey's generated
  output is checked by `scripts/check-sourcey-output.mjs`. The root `llms.txt`
  is repository orientation for coding agents; `docs/dist/llms*.txt` is the
  generated public-site context and must not be hand-maintained.
- `src/index.ts` is the only supported runtime import path; it re-exports the
  full public API from `buses.ts`, `init.ts`, `preferences-bridge.ts`, and
  `sprite-resolver.ts`. `src/build-tools/index.ts` is a **separate** entry
  point (`gesture-audio/build-tools`) so Node-only filesystem
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

Full invariants and error policy: `docs/architecture.md`.

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

- **`ci.yml`** — fork-safe `verify` (lint/typecheck/coverage/build/link checks
  on ubuntu with `ffmpeg`), `compatibility` (Node 22/24/26 × ubuntu/windows/
  macOS), Sourcey docs validation, dependency review, and a trusted-base
  `Repository Policy / gate` that blocks external fork control-plane changes.
  It runs without secrets or write permissions for ordinary PR validation.
- **`release.yml`** — `release-please` opens/updates the release PR from
  Conventional Commit PR titles on `main`; merging it publishes to npm with
  provenance. See `docs/releasing.md`.
- **`cd.yml`** — rebuilds and deploys `docs/` Sourcey output to this repo's own GitHub
  Pages (`build_type: workflow`) on every push to `main`. GitHub resolves
  `jonbogaty.com/gesture-audio/` for this repo automatically because the org
  apex repo `jbcom/jbcom.github.io` owns the verified `jonbogaty.com` custom
  domain — no cross-repo push is involved.

All GitHub Actions are pinned to exact commit SHAs (with a `# vX.Y.Z` comment)
per the fleet's supply-chain convention. Resolve a new SHA with `gh api
repos/<owner>/<repo>/git/ref/tags/<tag>` rather than trusting training data or
hand-typing one.

## Conventions

- Conventional Commits are the release contract. PR titles and the preserved
  merge-commit history drive `release-please`'s version bump and changelog.
  Use `feat!:` or a `BREAKING CHANGE:` footer only for an intentional public
  API break.
- `pnpm-workspace.yaml` lists two members: `.` (the library) and `docs`
  (the Sourcey site). A single root `pnpm-lock.yaml` covers both.
- Biome (`biome.json`) is the only linter/formatter; its `files.includes`
  covers `src/**`, `tests/**`, `scripts/**`, and Sourcey configuration.
  Markdown is checked through the rendered Sourcey output rather than treated
  as application code.
