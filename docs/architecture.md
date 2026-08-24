# Architecture

## Responsibilities

The package is four focused layers with no application singleton:

1. `init.ts` owns the gesture-gated start transaction. Tone unlock and caller
   bootstrap either both complete or the next gesture may retry.
2. `buses.ts` owns continuous Tone signal flow. The first caller-provided bus is
   the master and routes through a -1 dBFS limiter to the destination.
3. `sprite-resolver.ts` owns Howler sample sheets. It validates and flattens the
   map, creates one `Howl` per file, and tracks active sound IDs by target bus.
4. `preferences-bridge.ts` translates persisted percentages and mute policy into
   the two runtime engines without owning persistence.

The Node-only `build-tools` export is a separate entry point so filesystem and
process modules cannot enter a browser bundle.

## Invariants

- Audio initialization is never started during module evaluation.
- `started` means both Web Audio unlock and caller bootstrap succeeded.
- A bus topology cannot change silently; dispose before rebuilding it.
- Configured gain, duck attenuation, and mute reasons are independent state.
- Manual, focus-loss, and global-preference mutes cannot undo one another.
- Resolver initialization is idempotent for identical options and rejects
  different options until disposal.
- Preference read/update transactions are serialized per store so concurrent
  sliders cannot overwrite a newer runtime or persisted value with stale state.
- Every active Howler sound retains its target bus so live volume and mute
  changes affect loops and long samples, not only future playback.
- Public runtime imports do not evaluate Node-only build tooling.

## Lifecycle and cleanup

`registerAudioGestureTrigger` returns a listener cleanup. `disposeBuses` clears
duck timers and Tone nodes. `disposeSpriteResolver` unloads Howls, clears active
sound bookkeeping, and allows initialization with new options. `_resetAudioEngine`
is retained for existing test/hot-reload integrations; application shutdown
normally needs the returned listener cleanup plus the two disposal functions.

## Error policy

Programmer errors such as invalid topology, non-finite gain, path traversal, or
malformed verifier configuration throw immediately. Runtime sprite acquisition
degrades to an empty resolver by default because audio may be optional; strict
mode turns the same failure into a rejected bootstrap transaction. Persistence
errors are rethrown after restoring the prior runtime mix.
