---
title: API reference
description: Public entry points, input ranges, return values, and lifecycle contracts.
---

Import browser runtime APIs from `gesture-audio`. Import the filesystem-backed
verifier only from `gesture-audio/build-tools`.

| Entry point | Intended environment | Includes |
| --- | --- | --- |
| `gesture-audio` | Modern browser runtime; safe to import during SSR | lifecycle, Tone bus, resolver, and preferences APIs |
| `gesture-audio/howler` | Modern browser runtime; safe to import during SSR | lifecycle (unlocking Howler's context) and resolver APIs; never imports `tone` |
| `gesture-audio/build-tools` | Node.js 22, 24 and 26 build or CI process | audio-asset verification APIs |

`gesture-audio/howler` is for applications that play pre-rendered audio through
Howler sprites and build no Tone nodes. Its module graph is verified to contain
no `tone` import, so only Howler's `AudioContext` exists. It exports the
`startAudioEngine`, `registerAudioGestureTrigger`, `isAudioEngineStarted` and
`_resetAudioEngine` names with the contract below, except that the unlock step
resumes Howler's context (creating it if needed, or doing nothing when Howler has
fallen back to HTML5 Audio) instead of calling `Tone.start()`, and the gesture
trigger also listens for `pointerdown`. It also exports the whole
[sprite resolver](#sprite-resolver). It omits the Tone bus graph and the
preferences bridge. Use one entry point or the other in an application, never
both.

Underscored exports (`_resetAudioEngine`, `_getCueMap`, `_getLastResolverOptions`,
and `_getMasterBusName`) support tests and hot reload. Do not use them as
application integration APIs.

## Lifecycle

### `startAudioEngine(bootstrap)`

Runs `Tone.start()` and then `bootstrap` as one asynchronous, retryable
transaction. Call it from a real user-input handler. It resolves only when both
steps complete. Concurrent calls share the same attempt; after success, later
calls are no-ops. A rejection leaves the engine unstarted so a later gesture
can retry.

### `registerAudioGestureTrigger(bootstrap)`

Registers capture-phase `click`, `keydown`, and `touchstart` listeners on
`document`, and returns `() => void` to remove them. It is a browser-only
convenience: on the server it returns a no-op cleanup. The listener removes
itself only after a successful start; failures are warned and remain retryable.

### `isAudioEngineStarted()`

Returns `true` only after both the Tone unlock and the caller bootstrap have
succeeded.

## Tone bus graph

### `buildBuses(names)` and `getBuses()`

`buildBuses` accepts a non-empty, unique list of caller-owned names. The first
name is the master/root. Each other `Tone.Gain` connects to it, and the master
connects through a `Tone.Limiter(-1)` to the device destination. `limiter` is a
reserved name. It returns an `AudioBuses` map keyed by your names plus
`limiter`.

Calling it again with the exact same list returns the existing graph. To change
the topology, first call `disposeBuses()`. `getBuses()` throws before a graph
has been built.

### `setBusVolume(bus, linear, rampMs?)`

Sets a bus's remembered linear gain. `linear` is finite and is clamped to
`0..1`; `rampMs` defaults to `50`, must be finite, and must not be negative.
Unknown buses are harmless no-ops. A change while muted or ducked is retained
and becomes audible when those layers clear.

### `muteBus(bus, muted)` and `duckBus(bus, duckDb, durationMs?)`

`muteBus` adds or removes the manual mute layer with a short click-free ramp.
`duckBus` applies a non-positive decibel attenuation; a positive value throws.
Providing `durationMs` schedules restoration, and a new duck replaces an older
timed duck for that bus. A muted or unknown bus is left unchanged.

### `disposeBuses()`

Clears timed ducks, disposes every Tone node and limiter, and clears mix state.
Call it before rebuilding a different graph or during application teardown.

## Sprite resolver

### `initSpriteResolver(options?)`

Fetches a JSON map and creates one Howler `Howl` per unique sprite file.
Identical concurrent options share one initialization; changing options after
initialization requires `disposeSpriteResolver()` first.

| Option | Default | Contract |
| --- | --- | --- |
| `spriteMapUrl` | `/audio/sprite-map.json` | Non-empty URL for the JSON map. |
| `spriteMapUrls` | none | Non-empty array of distinct, non-empty URLs, fetched and merged into one cue map; use instead of `spriteMapUrl` (passing both throws). A cue defined in more than one map is an error under `strict`; otherwise the first definition wins and a warning names both maps. A failed request for any map fails the initialization. |
| `defaultPanner` | none | `PannerOptions` applied to any `playCue` that gives a `position` without its own `panner`. Changing it requires `disposeSpriteResolver()` first. |
| `audioBaseUrl` | `/audio` | Non-empty base path for sprite files. |
| `formats` | `['webm', 'm4a']` | Non-empty list of letter/digit extensions, in Howler preference order. |
| `preload` | `true` | When `false`, validates the JSON map and creates sheet definitions without fetching or decoding audio. The first `playCue` for each sheet queues playback and calls public `Howl.load()` for that sheet. |
| `strict` | `false` | Reject map/network/validation failures instead of warning and using an empty resolver. |

The map can be flat (`cue → entry`) or grouped (`group → cue → entry`). Every
entry has `start_ms`, `end_ms`, and an extensionless, traversal-safe relative
`file` path. An entry can also declare `formats` as a readonly ordered list of
encoded extensions and `loop: true` for an individual looping sprite. Every
cue sharing one `file` must declare the same ordered format list (or resolve to
the same resolver default); strict mode rejects a conflict. See
[sprite maps](./sprite-maps.md) for examples.

### `playCue(cueName, busTarget?)` and `playCue(cueName, options?)`

`playCue` starts a known cue and returns its Howler sound ID. It returns `-1`
when the resolver is not ready, the cue is absent, or its sheet is unavailable.
`busTarget` defaults to `sfx`; the additive options shape is
`{ bus?, gain?, position?: readonly [x, y, z] }`. Logical `gain` is clamped to
`0..1` and composes with current master and target-bus gains and mutes. A
position is sent through Howler's public spatial API.

`panner` (`PannerOptions`: `panningModel`, `distanceModel`, `refDistance`,
`rolloffFactor`, `maxDistance`, `coneInnerAngle`, `coneOuterAngle`,
`coneOuterGain`, all optional) is applied with Howler's `pannerAttr` for that
sound ID whenever a position is given, merged field by field over the resolver's
`defaultPanner`. If the cue is positioned later with `setCuePosition`, the
attributes are applied then, once. Values are validated (`refDistance` and
`rolloffFactor` `>= 0`, `maxDistance` `> 0`, cone angles `0..360`,
`coneOuterGain` `0..1`, models from the Web Audio enums) and invalid ones throw.
Howler's defaults are HRTF panning and no maximum distance; `equalpower` is much
cheaper on the audio thread.

`stopCue(id)` stops an active, non-negative ID and is otherwise a no-op.
`setCueGain(id, gain)` updates one active cue's logical gain and returns whether
the ID exists. `pauseCue(id)` pauses an active ID and returns whether it did;
`resumeCue(id)` resumes that same ID and returns it, or `-1` when it cannot.
`fadeCue(id, toGain, durationMs)` fades logical gain while still following live
bus/master volume and mute changes; a pause freezes that fade. `setCuePosition`
returns whether the ID exists after validating its position. Looping sprite IDs
remain active between loop-end events, so these controls continue to affect
them until stopped.

With `preload: false`, the resolver registers the returned ID before it starts
the sheet load. `stopCue`, mix updates, fades, pause/resume, and spatial updates
therefore still apply while the load is pending. A failed sheet removes its
pending IDs without throwing from `playCue`; a later cue can request that sheet
again.

### `setAudioListener(position, forward, up?)`

Sets the global Howler listener with public `Howler.pos` and
`Howler.orientation` APIs. All vectors are finite three-number tuples; `up`
defaults to `[0, 1, 0]`.

### `setResolverVolume(bus, linear)`, `setResolverMute(bus, muted)`, and `setResolverMasterBus(bus)`

Resolver volume is finite and clamped to `0..1`; an empty bus name throws.
Volume and mute updates affect active sounds as well as future cues. Designate
the bus that should globally scale/mute all Howler cues with
`setResolverMasterBus('master')`; pass `null` to remove that override.

### `disposeSpriteResolver()`

Unloads all Howls and clears cues, active sound bookkeeping, listener
registrations, pending logical fades, resolver mix state, and initialization
epochs. It is safe to call during teardown and is required before
reinitializing with different options.

## Preferences bridge

```ts
interface AudioPrefsSnapshot {
  audioVolumes: Record<string, number>; // persisted integer percentages
  muteOnFocusLoss?: boolean;
  muteAll?: boolean;
}

interface AudioPrefsStore {
  get(): Promise<AudioPrefsSnapshot>;
  update(patch: { audioVolumes: Record<string, number> }): Promise<void>;
}
```

All preference volumes are rounded and clamped to integer `0..100`. Store
updates are serialized per store; a failed write restores the preceding live
mix without allowing an older failed slider operation to overwrite a newer one.

| Function | Contract |
| --- | --- |
| `applyPersistedAudioPrefs(store, busNames, defaultVolume100?)` | Reads and applies volumes to Tone and Howler, then applies focus-loss and `muteAll` layers. Missing values use the `75` default or the supplied fallback. |
| `setAndPersistBusVolume(bus, vol100, store)` | Applies one normalized percentage and persists a complete merged `audioVolumes` map; rolls back the live value if persistence rejects. |
| `setAndPersistBusMute(bus, muted)` | Applies manual mute to Tone and Howler only. It does not write storage. |
| `syncAudioPrefsFromSettings(audioVolumes, busNames, store, defaultVolume100?)` | Normalizes, merges, applies, and persists several slider values as one serialized update. |
| `registerFocusLossMute(enabled, store?, busNames?)` | Registers/removes browser blur/focus listeners. Focus removes only the focus-loss layer, preserving manual and global mutes. |
| `setTransientAudioMute(busNames, reason, muted)` | Adds or removes a named runtime-only mute layer in both Tone and Howler. It never reads or writes persisted preferences and cannot remove a manual mute layer. |

## Node asset verification

`verifySprites(options)` returns `{ failures, warnings, lines }` and never
exits the process. `runVerifySpritesCli(options)` prints the lines and exits
with status 1 when failures are present.

| Option | Meaning |
| --- | --- |
| `audioRoot` | Required root directory containing audio assets. |
| `spriteBuses` | Required sprite subdirectories; each expects `sprite.json` and every configured encoded format. |
| `formats` | Encoded extensions; defaults to `webm` and `m4a`. |
| `flatGroups` | Optional extensionless-key files such as music tracks; set `required: true` to make missing files fail. |
| `fast` | Skips `ffprobe` duration and `ffmpeg` loudness measurement while retaining structural checks. |
| `lufsTarget`, `lufsTolerance` | Loudness target and permitted deviation; defaults to `-14 ± 3`. |
| `maxTotalBytes` | Optional total directory-size budget. |

The verifier rejects absolute paths and traversal in bus, group, and key
configuration before reading the filesystem. Full mode needs `ffmpeg` and
`ffprobe` on `PATH`; an unavailable measurement is a warning, while malformed
assets and required missing files are failures.
