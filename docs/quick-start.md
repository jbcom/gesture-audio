---
title: Quick start
description: Register a gesture trigger, build buses, resolve sprites, and apply preferences.
---

## Install

```sh
npm install gesture-audio tone howler
```

`tone` and `howler` are peer dependencies, so the application chooses their
versions. Node 22 or newer is required for development tooling.

## Bootstrap after a gesture

```ts
import {
  applyPersistedAudioPrefs,
  buildBuses,
  initSpriteResolver,
  playCue,
  registerAudioGestureTrigger,
  setResolverMasterBus,
} from 'gesture-audio';
import { preferences } from './audio-preferences.js';

const buses = ['master', 'music', 'sfx', 'voice'] as const;

async function bootstrapAudio() {
  buildBuses(buses);
  setResolverMasterBus('master');
  await initSpriteResolver({
    spriteMapUrl: '/audio/sprite-map.json',
    audioBaseUrl: '/audio',
    strict: true,
  });
  await applyPersistedAudioPrefs(preferences, buses);
}

const removeGestureTrigger = registerAudioGestureTrigger(bootstrapAudio);
```

Register the trigger early in application startup. The callback does not run
until a click, keydown, or touchstart supplies the required browser gesture.
Concurrent gestures share one attempt; listeners are removed only after both
the Web Audio unlock and bootstrap succeed. Call the returned cleanup during
hot reload or component teardown. From a later application action, after the
gesture bootstrap has resolved, play a cue with `playCue('drawer-open', 'sfx')`.

## Preferences contract

```ts
interface AudioPrefsStore {
  get(): Promise<{
    audioVolumes: Record<string, number>;
    muteOnFocusLoss?: boolean;
    muteAll?: boolean;
  }>;
  update(patch: { audioVolumes: Record<string, number> }): Promise<void>;
}
```

Volume percentages are rounded and clamped. Writes are serialized per store;
when a write rejects, the earlier runtime mix is restored without overwriting
a newer change. See the complete [browser bootstrap example](https://github.com/jbcom/gesture-audio/blob/main/examples/browser-bootstrap.ts).
