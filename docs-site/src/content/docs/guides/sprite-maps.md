---
title: Sprite maps
description: Sprite map shape, format resolution, and asset verification.
---

Both flat and file-grouped maps are accepted. Times are milliseconds and
`file` is relative to `audioBaseUrl`, without an extension.

```json
{
  "ui/sprite": {
    "drawer-open": {
      "start_ms": 0,
      "end_ms": 450,
      "file": "ui/sprite"
    }
  }
}
```

The default formats are `webm` and `m4a`. Invalid offsets, empty file names,
duplicates, and malformed entries are filtered with an actionable warning.
Use `strict: true` in production bootstrap or tests to reject the entire map
instead. A missing map degrades to a no-op resolver by default.

## Asset verification

The build-only entry point uses Node APIs and is kept out of the browser entry:

```ts
import { runVerifySpritesCli } from '@jbdevprimary/gesture-audio/build-tools';

await runVerifySpritesCli({
  audioRoot: 'public/audio',
  spriteBuses: ['ui', 'impact'],
  flatGroups: [{ dir: 'music', keys: ['menu', 'gameplay'], required: true }],
  maxTotalBytes: 12 * 1024 * 1024,
  fast: process.argv.includes('--fast'),
});
```

Full mode requires `ffmpeg` and `ffprobe` on `PATH` for duration and LUFS
checks. `fast: true` performs structural and budget checks without decoding
audio. Declared sprite buses are required; optional flat groups warn, while
`required: true` makes missing files fail.

See [`examples/verify-assets.ts`](https://github.com/jbcom/gesture-audio/blob/main/examples/verify-assets.ts)
for a complete build-script entry point.
