# gesture-audio

![A fingertip unlocks four audio lanes that converge through a limiter into one waveform.](https://raw.githubusercontent.com/jbcom/gesture-audio/main/docs/assets/gesture-audio-hero.webp)

[![CI](https://github.com/jbcom/gesture-audio/actions/workflows/ci.yml/badge.svg)](https://github.com/jbcom/gesture-audio/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/gesture-audio.svg)](https://www.npmjs.com/package/gesture-audio)
[![License: MIT](https://img.shields.io/badge/License-MIT-0b2239.svg)](./LICENSE)

Gesture-gated browser audio that starts reliably, mixes predictably, and keeps
application policy in your application.

Browsers will not resume a Web Audio context until a person interacts with the
page. A partial unlock is especially troublesome: the context can resume while
sample loading or preference hydration fails, leaving an app that believes
audio is ready when it is not. `gesture-audio` treats unlock and bootstrap as
one concurrent-safe, retryable transaction.

It also provides the infrastructure most interactive apps need around that
boundary:

- a typed, caller-named Tone.js bus graph with a master limiter;
- non-destructive, independently layered mute and timed ducking behavior;
- a validated Howler sprite-map resolver whose active sounds follow live mix changes;
- a persistence bridge for any small async preferences store; and
- a Node-only asset verifier for sprite structure, duration, loudness, orphans, and size.

The package deliberately does not define cue names, gameplay policy, or a
persistence framework. Those remain local to the application.

## Install

```sh
npm install gesture-audio tone howler
```

`tone` and `howler` are peer dependencies, so the application owns their versions.
Each is optional, and the entry point decides which one an application needs:
one that plays everything through Howler sprites can skip `tone` and import
[`gesture-audio/howler`](#howler-only-entry-point), and one that synthesises
everything with Tone can skip `howler` and import `gesture-audio/tone-lazy`.
The root entry uses both.

## Compatibility

Node.js 22, 24 and 26 are supported for build tooling (`engines.node: >=22`).
Support follows maintained Node lines, rather than requiring one exact patch.
CI verifies each supported major on Ubuntu. The runtime supports modern
browsers with Web Audio, `fetch`, and the event APIs used by Tone.js and Howler.

## Quick start

```ts
import {
  applyPersistedAudioPrefs,
  buildBuses,
  initSpriteResolver,
  playCue,
  registerAudioGestureTrigger,
  setResolverMasterBus,
} from 'gesture-audio';
// The application owns persistence; implement AudioPrefsStore against your
// own store. See examples/browser-bootstrap.ts for a full local-storage-
// backed implementation.
import { preferences } from './audio-preferences.js';

const BUS_NAMES = ['master', 'music', 'sfx', 'voice'] as const;

async function bootstrapAudio() {
  buildBuses(BUS_NAMES);
  setResolverMasterBus('master');
  await initSpriteResolver({
    spriteMapUrl: '/audio/sprite-map.json',
    audioBaseUrl: '/audio',
    strict: true,
  });
  await applyPersistedAudioPrefs(preferences, BUS_NAMES);
}

// Keep this registration early in application startup. Audio work itself does
// not run until click, keydown, or touchstart supplies the required gesture.
const removeGestureTrigger = registerAudioGestureTrigger(bootstrapAudio);

// Later, after bootstrap has completed:
const soundId = playCue('drawer-open', 'sfx');
```

The returned cleanup function is useful during hot reload or component
unmount. Concurrent gestures and direct `startAudioEngine()` calls share one
in-flight attempt. Listeners are removed only after both Tone unlock and the
application bootstrap succeed; a rejected attempt stays retryable.

See [`examples/browser-bootstrap.ts`](./examples/browser-bootstrap.ts) for a
complete local-storage-backed example. The published documentation has a
[complete integration guide](https://jonbogaty.com/gesture-audio/integration/)
covering teardown, strictness, SSR boundaries, and the intended lifecycle.

## Howler-only entry point

Importing the root entry loads Tone.js, which creates its own `AudioContext`
beside Howler's. An application that renders its sounds ahead of time and plays
them as Howler sprite cues needs only one context, so it should import
`gesture-audio/howler` instead:

```ts
import {
  initSpriteResolver,
  playCue,
  registerAudioGestureTrigger,
  setResolverMasterBus,
  setResolverVolume,
} from 'gesture-audio/howler';

async function bootstrapAudio() {
  setResolverMasterBus('master');
  setResolverVolume('master', 0.8);
  await initSpriteResolver({
    spriteMapUrls: ['/audio/ui-sprite-map.json', '/audio/ambience-sprite-map.json'],
    audioBaseUrl: '/audio',
    strict: true,
  });
}

registerAudioGestureTrigger(bootstrapAudio);
```

Nothing reachable from this entry imports `tone` (a test and the packed-import
smoke check both walk the module graph), so no Tone nodes or second context ever
exist. It exports the sprite resolver (`initSpriteResolver`, `playCue`,
`stopCue`, `setCueGain`, `pauseCue`, `resumeCue`, `fadeCue`, `setCuePosition`,
`setAudioListener`, `setAudioSuspended`, `setResolverVolume`, `setResolverMute`,
`setResolverMasterBus`, `disposeSpriteResolver`) and the same lifecycle names as
the root entry, with the same contract:
`registerAudioGestureTrigger(bootstrap)`, `startAudioEngine(bootstrap)` and
`isAudioEngineStarted()`. The difference is the unlock step: on a click, keydown,
touchstart or pointerdown it resumes Howler's own `AudioContext` (creating it
first if Howler has not yet), then runs `bootstrap`. Attempts are serialized and
a failed resume or bootstrap stays retryable. `setAudioSuspended(true | false)`
suspends or resumes Howler's context (for example when the app is backgrounded
or foregrounded) so you never need to import `howler` for that; it is also
exported from the root entry. It does not include the Tone bus
graph or the preferences bridge, which drives that graph; mirror volume and mute
into the resolver directly. Use one entry point or the other in an application,
not both.

## Sprite maps

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

To split cues across several files (for example one per feature), pass
`spriteMapUrls` instead of `spriteMapUrl`. All maps are fetched, flat and
grouped shapes may be mixed, and they merge into one cue map. A cue name defined
in more than one map is an error under `strict`; otherwise the first definition
(in array order) wins and a warning names both maps. A failed request for any
listed map fails the whole initialization, the same way a single missing map
does.

### Spatial playback

A `playCue` call that gives a `position` can also give `panner` attributes, and
`initSpriteResolver` accepts `defaultPanner` for cues that give a position
without their own. They are applied with Howler's `pannerAttr` for that sound
only. Howler's own defaults are HRTF panning with no maximum distance, which is
costly on the audio thread; most games want equal-power panning:

```ts
await initSpriteResolver({
  defaultPanner: { panningModel: 'equalpower', distanceModel: 'linear', refDistance: 1, maxDistance: 30 },
});
playCue('door-slam', { position: [4, 0, -2] }); // uses defaultPanner
playCue('torch-crackle', { position: [1, 1, 0], panner: { maxDistance: 8 } }); // merged over it
```

## Preferences contract

The bridge accepts any store with this shape:

```ts
interface AudioPrefsStore {
  get(): Promise<{
    audioVolumes: Record<string, number>; // integer percentages, 0-100
    muteOnFocusLoss?: boolean;
    muteAll?: boolean;
  }>;
  update(patch: { audioVolumes: Record<string, number> }): Promise<void>;
}
```

Values are rounded and clamped before runtime application and persistence.
Writes are serialized per store, and failed writes restore the previous live
mix before rethrowing without racing newer changes. Focus-loss and
global-preference mutes are separate layers, so regaining focus cannot
accidentally undo an explicit user mute. The bridge never writes settings while
applying runtime mute behavior.

## Public API

| Area | Exports |
| --- | --- |
| Lifecycle | `startAudioEngine`, `registerAudioGestureTrigger`, `isAudioEngineStarted` (also from `gesture-audio/howler`, unlocking Howler's context instead of Tone's) |
| Tone buses | `buildBuses`, `getBuses`, `setBusVolume`, `muteBus`, `duckBus`, `disposeBuses` |
| Sprites | `initSpriteResolver`, `playCue`, `stopCue`, `setResolverVolume`, `setResolverMute`, `setResolverMasterBus`, `disposeSpriteResolver` |
| Preferences | `applyPersistedAudioPrefs`, `setAndPersistBusVolume`, `setAndPersistBusMute`, `syncAudioPrefsFromSettings`, `registerFocusLossMute` |
| Build tools | `verifySprites`, `runVerifySpritesCli` from `gesture-audio/build-tools` |

Bus gain is linear from `0` to `1`. Preference volume is an integer percentage
from `0` to `100`. The first bus passed to `buildBuses` is the master/root bus;
names must be non-empty and unique, and `limiter` is reserved. Rebuilding with
a different topology requires `disposeBuses()` first.

`duckBus(name, negativeDb, durationMs?)` replaces any existing duck for that
bus. A volume change during ducking updates the remembered base level without
removing the attenuation.

## Asset verification

The build-only entry point uses Node APIs and is kept out of the browser entry:

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

Full mode requires `ffmpeg` and `ffprobe` on `PATH` for duration and LUFS
checks. `fast: true` performs structural and budget checks without decoding
audio. Declared sprite buses are required; optional flat groups warn, while
`required: true` makes missing files fail.

## Architecture and compatibility

The runtime dependency direction is intentionally one-way: lifecycle unlocks
the caller bootstrap; Tone owns the continuous bus graph; Howler owns sample
playback; the preference bridge mirrors policy into both. Details and
invariants are in the [architecture guide](https://jonbogaty.com/gesture-audio/architecture/).

The package ships ESM and CommonJS builds with distinct declarations and
exports. CI checks real packed imports plus `publint` and
`are-the-types-wrong`. Browser globals are accessed only when the relevant API
is called, so server-side importing is safe; starting playback still requires a browser.

The [API reference](https://jonbogaty.com/gesture-audio/api-reference/) records
every public function's input ranges, return behavior, and cleanup contract.

## Troubleshooting

Common autoplay, silent-cue, sprite-format, and `ffmpeg` failures are covered
in the [troubleshooting guide](https://jonbogaty.com/gesture-audio/troubleshooting/). The most important
rule is to register the gesture trigger early and do all audio bootstrap work
inside its callback.

## Development

```sh
mise install
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` runs formatting/lint checks, strict TypeScript, behavioral tests
with enforced coverage thresholds, both module builds, packed import smoke
tests, and package metadata/type validation. See
[`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`SECURITY.md`](./SECURITY.md).

Releases use Conventional Commit titles and release-please; npm publishing is
performed from the generated Git tag with provenance. See the
[releasing guide](https://jonbogaty.com/gesture-audio/releasing/).

## License

[MIT](./LICENSE) © 2026 Jon Bogaty
