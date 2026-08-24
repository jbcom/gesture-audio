# Releasing

Releases are generated from `main` by release-please:

1. Conventional Commit pull-request titles determine the next pre-1.0 version.
2. Release-please updates `CHANGELOG.md`, `package.json`, and the manifest in a
   release pull request.
3. Merging that pull request creates the GitHub release and tag.
4. The publish job checks out the exact tag, runs `pnpm verify`, and publishes
   the public package with npm provenance.

The first npm publication requires an automation token in the `NPM_TOKEN`
repository secret because the package settings page does not exist yet. After
that succeeds, configure npm trusted publishing for GitHub repository
`jbcom/gesture-audio` and workflow `release.yml`, verify an OIDC release, then
remove the token fallback. Never put tokens in `.npmrc` or repository files.

Before merging a release pull request, confirm CI and CodeQL are green and run:

```sh
pnpm install --frozen-lockfile
pnpm verify
npm view @jbdevprimary/gesture-audio version
```

The final command is expected to fail before the first publication and should
match the new tag after publishing.
