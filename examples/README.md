# Examples

- [`browser-bootstrap.ts`](./browser-bootstrap.ts) demonstrates the complete
  gesture-to-playback path with a small localStorage preferences adapter.
- [`verify-assets.ts`](./verify-assets.ts) is a build-script entry point for
  `tsx examples/verify-assets.ts --fast` after adapting the manifest to an app.

The examples import the published package and its `/build-tools` entry point.
This repository maps those names to source during type checking so the examples
are validated before a package build exists.
