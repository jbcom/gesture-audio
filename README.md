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
