# @arcade-cabinet/audio-engine

Gesture-gated audio engine core, extracted from
[on-the-ropes](https://redacted-private-registry.example/arcade-cabinet/on-the-ropes)'
`src/audio/` — the tournament-winning `audio-engine` pattern across the
arcade-cabinet fleet.

Tone.js owns the bus graph (master → limiter → destination, plus caller-named
sub-buses); Howler owns sample playback purely as a sprite-based sample
player; a thin preferences bridge wires a caller-supplied prefs store +
blur/focus mute-on-background into both. Deliberately excludes any
game-specific concepts (era tinting, crowd-noise mixing, cue vocabularies) —
those stay in the consuming game.

## Install

```sh
pnpm add @arcade-cabinet/audio-engine tone howler
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
} from '@arcade-cabinet/audio-engine';

const BUS_NAMES = ['master', 'music', 'sfx', 'voice', 'crowd'] as const;

async function bootstrap() {
  buildBuses(BUS_NAMES);
  await initSpriteResolver({ spriteMapUrl: '/audio/sprite-map.json' });
  await applyPersistedAudioPrefs(myPrefsStore, BUS_NAMES);
}

// Defers all audio init until the first user gesture (Tone.js requirement).
registerAudioGestureTrigger(bootstrap);

// Later, anywhere in the app:
playCue('drawer-open', 'sfx');
```

### Preferences store contract

`applyPersistedAudioPrefs` / `setAndPersistBusVolume` / `syncAudioPrefsFromSettings`
accept any store satisfying:

```ts
interface AudioPrefsStore {
  get(): Promise<{ audioVolumes: Record<string, number>; muteOnFocusLoss?: boolean; muteAll?: boolean }>;
  update(patch: { audioVolumes: Record<string, number> }): Promise<void>;
}
```

No coupling to a specific persistence manager — wrap whatever the host game
already uses (localStorage, IndexedDB, a Zustand store, Capacitor Preferences...).

## `@arcade-cabinet/audio-engine/build-tools`

A generic CI asset verifier (`verifySprites` / `runVerifySpritesCli`),
extracted from on-the-ropes' `audio-verify` script — checks sprite-bus file
presence, sprite-map offset/duration sanity, orphan files, LUFS loudness
targets (via `ffmpeg`/`ffprobe`), and a total byte budget. Parameterized —
no game-specific bus/cue names baked in.

```ts
import { runVerifySpritesCli } from '@arcade-cabinet/audio-engine/build-tools';

await runVerifySpritesCli({
  audioRoot: 'public/audio',
  spriteBuses: ['ui', 'impact', 'whoosh'],
  flatGroups: [{ dir: 'crowd-bed', keys: ['silent', 'murmur', 'invested', 'pop', 'riot'] }],
  maxTotalBytes: 12 * 1024 * 1024,
  fast: process.argv.includes('--fast'),
});
```

## Build

```sh
pnpm --filter @arcade-cabinet/audio-engine build   # dist/{esm,cjs,types}
pnpm --filter @arcade-cabinet/audio-engine test
```
