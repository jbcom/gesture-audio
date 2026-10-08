---
title: Sprite maps
description: Define Howler sprite sheets and verify the audio assets before shipping.
---

Both flat and file-grouped maps are accepted. Times are milliseconds and
`file` is relative to `audioBaseUrl`, without an extension.

Flat maps use a cue name at the top level; grouped maps use an arbitrary group
name, then the cue name. The two equivalent shapes below are both valid:

```json
{
  "drawer-open": {
    "start_ms": 0,
    "end_ms": 450,
    "file": "ui/sprite"
  }
}
```

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

An entry may override its file's codec preference list and request sprite
looping. Every entry pointing at the same `file` must use exactly the same
ordered `formats` list, because Howler chooses one codec for that file rather
than falling back after an HTTP error. `loop: true` becomes Howler's third
sprite tuple value and the resolver retains that sound ID across loop ends.

```json
{
  "burial-chamber-ambience": {
    "start_ms": 0,
    "end_ms": 32000,
    "file": "music/burial-chamber",
    "formats": ["wav", "ogg"],
    "loop": true
  }
}
```

`file` must be a non-empty path inside `audioBaseUrl`, with no `.` or `..`
segments or backslashes. A leading slash is ignored; it is not a cue namespace. For
`audioBaseUrl: '/audio'` and `file: 'ui/sprite'`, Howler receives
`/audio/ui/sprite.webm` and `/audio/ui/sprite.m4a`. Supply at least two formats
that cover the browsers you support, and keep their cue offsets identical.

## Load only requested sheets

`initSpriteResolver()` preserves its eager default and asks Howler to preload
every declared sheet. Games with large maps can opt into on-demand sheet loads:

```ts
await initSpriteResolver({ preload: false, strict: true });
```

This still fetches and validates `sprite-map.json` during initialization so
invalid maps fail at bootstrap in strict mode. It creates each sheet definition
without fetching or decoding its audio. The first `playCue` for a sheet queues
that cue and loads just that sheet through Howler's public API. It avoids unused
sheet fetches and decoding; it does not make a network or device-performance
guarantee.

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

See [API reference](./api-reference.md) for the complete verifier option
contract and [integration guide](./integration.md) for runtime strictness.
