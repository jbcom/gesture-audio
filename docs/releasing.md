# Releasing

Releases are generated from `main` by release-please:

1. Conventional Commit pull-request titles determine the next pre-1.0 version.
2. Release-please updates `CHANGELOG.md`, `package.json`, and the manifest in a
   release pull request.
3. Merging that pull request creates the GitHub release and tag.
4. The release tag triggers `cd.yml`; its publish job checks out that exact
   tag, runs `pnpm verify`, and publishes with npm provenance via the npm OIDC
   trusted publisher for `jbcom/gesture-audio` and `cd.yml`.

No npm token belongs in a repository secret, `.npmrc`, or repository file.

Before merging a release pull request, confirm CI and GitHub's default code
scanning check are green and run:

```sh
pnpm install --frozen-lockfile
pnpm verify
npm view gesture-audio version
```

The final command should match the new tag after the release publishes.
