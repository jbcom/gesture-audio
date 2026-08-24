---
title: Contributing
description: Local setup, validation, commit conventions, and pull-request expectations.
---

See the repository [CONTRIBUTING.md](https://github.com/jbcom/gesture-audio/blob/main/CONTRIBUTING.md)
for the complete contributor guide. The short version:

```sh
mise install
pnpm install --frozen-lockfile
pnpm verify
```

Use Conventional Commits, create an upstream topic branch, open a pull request,
and merge with a merge commit after automated policy gates pass. Never commit
credentials or generated `docs/dist` output.
