# Repository decisions

## Maintained Node lines

The package supports Node.js 22, 24 and 26 with `engines.node: >=22`.
The runtime remains a browser API; the separate `gesture-audio/build-tools`
entry point supports the same Node range. CI runs the full verification suite
on each maintained major on Ubuntu, with additional operating-system coverage.
Local development defaults to Node 26. Documentation and deployment jobs use
`lts/*`. These selectors never require equality to an exact patch release.

## Repository rules

`CI / gate` aggregates every job in the CI workflow and rejects failure or
cancellation while accepting successful or intentionally skipped jobs.

The trusted policy job reports `Repository Policy / gate` directly against
the PR head commit. Its job name differs from that required status, so an
intentionally skipped validation job cannot satisfy the trusted policy.
Fork changes to the ruleset administration script are protected alongside
other control-plane files.

`scripts/apply-branch-ruleset.mjs` is the canonical repository ruleset script.
Its omitted arguments default to `gesture-audio` and
`CI / gate;title;Repository Policy / gate;Dependency Review / gate`.
It manages main integrity, Conventional Commits, and release-tag integrity,
without Copilot review or Code Quality rules. It is an explicit administrative
tool and is never run by verification. Its canonical formatting is preserved
with a file-specific Biome formatter override; lint checks remain enabled.
