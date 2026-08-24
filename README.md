# @jbcom/gesture-audio

[![CI](https://github.com/jbcom/gesture-audio/actions/workflows/ci.yml/badge.svg)](https://github.com/jbcom/gesture-audio/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@jbcom/gesture-audio.svg)](https://www.npmjs.com/package/@jbcom/gesture-audio)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**Browsers refuse to start audio until the user has interacted with the page.**
Getting that wrong is silent — no error, no sound, and a bug report that says
"audio doesn't work sometimes."

`gesture-audio` makes the unlock the center of the design rather than an
afterthought. It defers every bit of audio initialisation until a real user
gesture arrives, treats unlock-and-bootstrap as one retryable transaction, and
only then reports the engine as started.

Around that it provides the two pieces most apps end up writing anyway: a
[Tone.js](https://tonejs.github.io) bus graph (master → limiter → destination,
plus your own named sub-buses) and a [Howler](https://howlerjs.com) sprite
resolver for sample playback, wired to a preferences store you supply.

It deliberately contains no app-specific concepts — no cue vocabularies, no
mixing policy. Those stay in your app.

## Install

```sh
npm install @jbcom/gesture-audio tone howler
```

`tone` and `howler` are peer dependencies — bring your own pinned versions.

## Usage

```ts
import {
  buildBuses,
  registerAudioGestureTrigger,
  initSpriteResolver,
  playCue,
  applyPersistedAudioPrefs,
} from '@jbcom/gesture-audio';

const BUS_NAMES = ['master', 'music', 'sfx', 'voice', 'crowd'] as const;

async function bootstrap() {
  buildBuses(BUS_NAMES);
  await initSpriteResolver({ spriteMapUrl: '/audio/sprite-map.json' });
  await applyPersistedAudioPrefs(myPrefsStore, BUS_NAMES);
}

// Defers all audio init until the first user gesture (a browser requirement).
registerAudioGestureTrigger(bootstrap);

// Later, anywhere in the app:
playCue('drawer-open', 'sfx');
```

### Why the unlock is a transaction

Unlock and bootstrap succeed or fail together:

- **Concurrent callers share one in-flight attempt.** Two gestures racing will
  not build the bus graph twice.
- **The engine reports `started` only after both stages succeed** — not after
  the `AudioContext` resumes but before your samples load.
- **A rejected attempt leaves the gesture listeners armed**, so the next real
  interaction retries instead of leaving the app permanently silent.

That last point is the one that is easy to miss: an unlock can fail, and if you
tear the listeners down on the first try, there is no second one.

### Preferences store contract

`applyPersistedAudioPrefs` / `setAndPersistBusVolume` / `syncAudioPrefsFromSettings`
accept any store satisfying:

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

No coupling to a specific persistence layer — wrap whatever you already use
(localStorage, IndexedDB, a Zustand store, Capacitor Preferences, …).

Bus mute is non-destructive: unmuting restores the last configured gain, and
volume changes made while muted take effect when the bus is unmuted.
`muteOnFocusLoss` applies to the full bus list you supply.

## API reference

The example above covers the common path — build buses, load the sprite map,
apply prefs, defer everything behind a gesture. The rest of the public API:

### Bus control (`buses.ts`)

```ts
import { getBuses, setBusVolume, muteBus, duckBus, disposeBuses } from '@jbcom/gesture-audio';

// Read the live topology built by buildBuses() — same object every call.
const buses = getBuses<(typeof BUS_NAMES)[number]>();

// Settings-panel slider: 0-1 linear gain, ramped over 50ms by default.
setBusVolume('music', 0.6);
setBusVolume('sfx', 0.8, 0); // rampMs=0 — instant, e.g. on startup

// Mute/unmute non-destructively — unmuting restores the last configured level.
muteBus('voice', true);
muteBus('voice', false);

// Ducking: temporarily attenuate a bus by a dB amount, auto-restoring after
// durationMs (e.g. duck music while a narration line plays).
duckBus('music', -12, 2000);

// Tear down the whole graph — app unmount, hot-reload, or test cleanup.
disposeBuses();
```

### Engine lifecycle (`init.ts`)

```ts
import { startAudioEngine, isAudioEngineStarted } from '@jbcom/gesture-audio';

// Usually you don't call this directly — registerAudioGestureTrigger wires
// it to the first click/keydown/touchstart. But a "Tap to start" overlay
// can call it explicitly from its own click handler (which is itself a
// user gesture, so this is safe):
async function onTapToStart() {
  await startAudioEngine(bootstrap);
}

// Gate UI on whether audio is live yet (e.g. hide the "tap to start" overlay).
if (isAudioEngineStarted()) {
  /* show the game, hide the overlay */
}
```

### Preferences bridge extras (`preferences-bridge.ts`)

```ts
import { setAndPersistBusMute, registerFocusLossMute } from '@jbcom/gesture-audio';

// Mute a single bus at runtime (e.g. a per-bus mute button). Unlike
// setAndPersistBusVolume this is NOT persisted to the store — persist it
// yourself (e.g. by storing volume=0) if it needs to survive reload.
setAndPersistBusMute('voice', true);

// Auto-mute every configured bus on window blur, restoring on focus only if
// the store still reports muteOnFocusLoss: true at that time. Call with
// enabled=false to tear the listeners down.
registerFocusLossMute(true, myPrefsStore, BUS_NAMES);
registerFocusLossMute(false);
```

### Sprite resolver extras (`sprite-resolver.ts`)

```ts
import {
  stopCue,
  setResolverVolume,
  setResolverMute,
  setResolverMasterBus,
  disposeSpriteResolver,
} from '@jbcom/gesture-audio';

// playCue() returns a Howler sound id you can stop early (e.g. a looping
// cue interrupted by a state change).
const id = playCue('crowd-riot-loop', 'crowd');
stopCue(id);

// Lower-level volume/mute knobs the preferences bridge calls for you —
// use these directly only if you're not going through
// applyPersistedAudioPrefs/setAndPersistBusVolume.
setResolverVolume('sfx', 0.8);
setResolverMute('sfx', false);

// Designate which bus name acts as the resolver's "master" override (mutes
// / scales every cue regardless of target bus). Optional — buses.ts already
// treats its first bus name as master by convention, and the preferences
// bridge relies on that; call this only if your resolver's master bus name
// differs from what you pass to applyPersistedAudioPrefs.
setResolverMasterBus('master');

// Tear down all loaded Howl instances — tests / hot-reload.
disposeSpriteResolver();
```

## `@jbcom/gesture-audio/build-tools`

A generic CI asset verifier (`verifySprites` / `runVerifySpritesCli`) that
checks sprite-bus file presence, sprite-map offset/duration sanity, orphan
files, LUFS loudness targets (via `ffmpeg`/`ffprobe`), and a total byte budget.
Fully parameterised — no bus or cue names are baked in.

```ts
import { runVerifySpritesCli } from '@jbcom/gesture-audio/build-tools';

await runVerifySpritesCli({
  audioRoot: 'public/audio',
  spriteBuses: ['ui', 'impact', 'whoosh'],
  flatGroups: [{ dir: 'crowd-bed', keys: ['silent', 'murmur', 'invested', 'pop', 'riot'] }],
  maxTotalBytes: 12 * 1024 * 1024,
  fast: process.argv.includes('--fast'),
});
```

This entrypoint is build-time only and uses Node APIs; it is not part of the
browser bundle.

## Compatibility

Ships dual ESM and CommonJS builds with separate type declarations for each, so
`import` and `require` both resolve correctly under Node16 module resolution.
Verified in CI with [publint](https://publint.dev) and
[are-the-types-wrong](https://arethetypeswrong.github.io).

## Development

```sh
pnpm install
pnpm verify     # lint, typecheck, test, build, package checks
```

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
