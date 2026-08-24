---
title: Sprite maps
description: Define Howler sprite sheets and verify the audio assets before shipping.
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

The default formats are `webm` and `m4a`. Invalid offsets, empty names,
duplicates, and malformed entries emit actionable warnings. Use `strict: true`
to reject the whole map instead. A missing map otherwise degrades to a no-op
resolver, which is useful when audio is optional.

## Verify assets in build tooling

```ts
import { runVerifySpritesCli } from 'gesture-audio/build-tools';

await runVerifySpritesCli({
  audioRoot: 'public/audio',
  spriteBuses: ['ui', 'impact'],
  flatGroups: [{ dir: 'music', keys: ['menu', 'gameplay'], required: true }],
  maxTotalBytes: 12 * 1024 * 1024,
  fast: process.argv.includes('--fast'),
});
```

Full mode uses `ffmpeg` and `ffprobe` for duration and LUFS checks. `fast`
keeps structural and byte-budget checks only. The build-tools entry point is
Node-only and must never be imported from browser runtime code.
