---
title: API reference
description: Public entry points and behavioral contracts for gesture-audio.
---

The browser-safe runtime is imported from `gesture-audio`. Node filesystem and
process code is isolated in `gesture-audio/build-tools`.

| Area | Public exports |
| --- | --- |
| Lifecycle | `startAudioEngine`, `registerAudioGestureTrigger`, `isAudioEngineStarted` |
| Tone buses | `buildBuses`, `getBuses`, `setBusVolume`, `muteBus`, `duckBus`, `disposeBuses` |
| Sprites | `initSpriteResolver`, `playCue`, `stopCue`, `setResolverVolume`, `setResolverMute`, `setResolverMasterBus`, `disposeSpriteResolver` |
| Preferences | `applyPersistedAudioPrefs`, `setAndPersistBusVolume`, `setAndPersistBusMute`, `syncAudioPrefsFromSettings`, `registerFocusLossMute` |
| Build tools | `verifySprites`, `runVerifySpritesCli` |

## Lifecycle

`startAudioEngine(bootstrap)` starts Tone and the supplied bootstrap as one
retryable transaction. `registerAudioGestureTrigger(bootstrap)` defers that
work until browser input and returns a cleanup function.

## Buses

`buildBuses(names)` requires a non-empty list of unique names. The first is
the master bus; `limiter` is reserved. Bus gain is linear from `0` to `1`.
`muteBus` layers a named mute reason without discarding gain, while
`duckBus(name, negativeDb, durationMs?)` replaces any active duck for that bus.
Call `disposeBuses()` before rebuilding a different topology.

## Sprites and preferences

Initialize the resolver once with `initSpriteResolver`, then call `playCue`
with a cue and target bus. Active sounds retain their target bus so future
volume and mute operations affect loops as well as new playback. Preference
helpers accept the store described in the [quick start](./quick-start.md) and
keep focus-loss, global-preference, and manual muting independent.

For full implementation-level invariants, read [architecture](./architecture.md).
