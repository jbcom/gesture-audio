---
title: Releasing
description: How release-please, provenance publishing, and trusted publishing fit together.
---

Releases are generated from `main` by release-please:

1. Conventional Commit pull-request titles determine the next pre-1.0 version.
2. Release-please updates `CHANGELOG.md`, `package.json`, and the manifest in a
   release pull request.
3. Merging that pull request creates the GitHub release and tag.
4. The publish job checks out the exact tag, runs `pnpm verify`, and publishes
   the public package with npm provenance.

The first npm publication requires an automation token in the `NPM_TOKEN`
repository secret because the package settings page does not exist yet. After
that succeeds, npm trusted publishing (OIDC) is configured for GitHub
repository `jbcom/gesture-audio` and workflow `release.yml`, verified with an
OIDC release, then the token fallback is removed. Tokens are never committed
to `.npmrc` or repository files.

Before merging a release pull request, confirm CI and GitHub's default code
scanning check are green and run:

```sh
pnpm install --frozen-lockfile
pnpm verify
npm view @jbdevprimary/gesture-audio version
```
