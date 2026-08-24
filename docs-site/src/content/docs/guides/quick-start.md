---
title: Quick start
description: Register the gesture trigger, build buses, and play your first cue.
---

## Install

Node 22 or newer is required for build tooling. The runtime supports modern
browsers with Web Audio, `fetch`, and the event APIs used by Tone.js and Howler.

```sh
npm install @jbdevprimary/gesture-audio tone howler
```

`tone` and `howler` are peer dependencies, so the application owns their versions.

## Bootstrap

```ts
import {
  applyPersistedAudioPrefs,
  buildBuses,
  initSpriteResolver,
  playCue,
  registerAudioGestureTrigger,
  setResolverMasterBus,
} from '@jbdevprimary/gesture-audio';

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

See [`examples/browser-bootstrap.ts`](https://github.com/jbcom/gesture-audio/blob/main/examples/browser-bootstrap.ts)
for a complete local-storage-backed example.

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
| Lifecycle | `startAudioEngine`, `registerAudioGestureTrigger`, `isAudioEngineStarted` |
| Tone buses | `buildBuses`, `getBuses`, `setBusVolume`, `muteBus`, `duckBus`, `disposeBuses` |
| Sprites | `initSpriteResolver`, `playCue`, `stopCue`, `setResolverVolume`, `setResolverMute`, `setResolverMasterBus`, `disposeSpriteResolver` |
| Preferences | `applyPersistedAudioPrefs`, `setAndPersistBusVolume`, `setAndPersistBusMute`, `syncAudioPrefsFromSettings`, `registerFocusLossMute` |
| Build tools | `verifySprites`, `runVerifySpritesCli` from `@jbdevprimary/gesture-audio/build-tools` |

Bus gain is linear from `0` to `1`. Preference volume is an integer percentage
from `0` to `100`. The first bus passed to `buildBuses` is the master/root bus;
names must be non-empty and unique, and `limiter` is reserved. Rebuilding with
a different topology requires `disposeBuses()` first.

`duckBus(name, negativeDb, durationMs?)` replaces any existing duck for that
bus. A volume change during ducking updates the remembered base level without
removing the attenuation.

See the [API reference](/reference/) for full signatures.
