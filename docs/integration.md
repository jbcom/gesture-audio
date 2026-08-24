---
title: Integration guide
description: A complete lifecycle for gesture-gated audio, from browser input through cleanup.
---

This guide shows the intended ownership boundary. `gesture-audio` owns the
audio infrastructure; your application owns its cue names, audio files,
preferences implementation, and product decisions.

## The lifecycle

1. Define one stable list of bus names. The first name is the master bus.
2. Register a gesture trigger during application setup.
3. In its bootstrap callback, build buses, configure the resolver, load the
   sprite map, then apply persisted preferences.
4. Play cues only after that bootstrap has completed.
5. On teardown, remove the gesture listener and dispose the buses and resolver.

The ordering in step 3 matters. A successful lifecycle means both `Tone.start()`
and the full callback succeeded. If a map request or preferences read fails in
strict mode, the listener stays armed and a later real gesture retries the
whole transaction.

## A complete browser integration

```ts
import {
  type AudioPrefsSnapshot,
  type AudioPrefsStore,
  applyPersistedAudioPrefs,
  buildBuses,
  disposeBuses,
  disposeSpriteResolver,
  initSpriteResolver,
  playCue,
  registerAudioGestureTrigger,
  setAndPersistBusVolume,
  setResolverMasterBus,
} from 'gesture-audio';

const BUS_NAMES = ['master', 'music', 'sfx', 'voice'] as const;

const preferences: AudioPrefsStore = {
  async get(): Promise<AudioPrefsSnapshot> {
    return {
      audioVolumes: { master: 80, music: 65, sfx: 85, voice: 90 },
      muteOnFocusLoss: true,
    };
  },
  async update(patch) {
    // Merge and persist `patch.audioVolumes` in the application's store.
  },
};

const removeGestureTrigger = registerAudioGestureTrigger(async () => {
  buildBuses(BUS_NAMES);
  setResolverMasterBus('master');
  await initSpriteResolver({
    spriteMapUrl: '/audio/sprite-map.json',
    audioBaseUrl: '/audio',
    formats: ['webm', 'm4a'],
    strict: true,
  });
  await applyPersistedAudioPrefs(preferences, BUS_NAMES);
});

export function openDrawer(): void {
  playCue('drawer-open', 'sfx');
}

export async function setMusicPercent(percent: number): Promise<void> {
  await setAndPersistBusVolume('music', percent, preferences);
}

export function disposeAudio(): void {
  removeGestureTrigger();
  disposeSpriteResolver();
  disposeBuses();
}
```

Use the cleanup function in a component unmount or hot-reload hook. Do not call
the underscored exports in ordinary application code; they are test and
hot-reload escape hatches, not part of the supported integration contract.

## Gesture and retry behavior

`registerAudioGestureTrigger` listens for `click`, `keydown`, and `touchstart`
on `document` in the capture phase. It does no audio work until one of those
events occurs. Repeated registrations share one listener; repeated gestures
and direct `startAudioEngine()` calls share one in-flight attempt.

The listener is removed only after `Tone.start()` and your bootstrap callback
both resolve. A rejection leaves it installed, logs a warning, and allows a
later person-generated gesture to retry. If you use your own “Enable sound”
button, call `await startAudioEngine(bootstrap)` from that button's event
handler instead of registering the document trigger.

## Mixing policy

All bus volume values are linear amplitudes from `0` to `1`; persisted values
are integer percentages from `0` to `100`. The master bus controls both Tone
and Howler only after `setResolverMasterBus('master')` identifies it.

Manual mute, focus-loss mute, and the persisted `muteAll` preference are
independent layers. Removing one does not undo another. `duckBus` is likewise
independent of configured volume: changing a volume while ducked updates the
level that will be restored when the duck ends.

`setAndPersistBusMute` intentionally changes the live mix only. If mute state
must survive a reload, represent that policy in your own preferences store—for
example, by persisting a zero volume—and apply it during the next bootstrap.

## SSR and framework boundaries

Importing `gesture-audio` is safe in server-side rendering because it does not
touch browser globals during module evaluation. Call the lifecycle APIs only in
the browser, after your client component has mounted. Keep the Node-only asset
verifier in build scripts by importing it from `gesture-audio/build-tools`; do
not import that entry point into a browser bundle.

## Choose strictness deliberately

Use `strict: true` for required interactive audio. It makes an unavailable,
invalid, or malformed sprite map reject bootstrap so the next gesture can
retry. With the default `strict: false`, the resolver warns and becomes an
empty, ready resolver; `playCue` returns `-1`. That is useful when audio is an
optional enhancement, but it should not hide an expected asset failure in a
production game.

Continue with [sprite maps](./sprite-maps.md) for the asset format and
[API reference](./api-reference.md) for each public function.
