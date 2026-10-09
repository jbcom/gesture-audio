/**
 * gesture-audio/howler — the Howler-only entry point.
 *
 * For applications that play pre-rendered audio entirely through Howler
 * sprites and never build Tone.js nodes. Nothing reachable from this module
 * imports `tone`, so importing it does not load Tone or create Tone's
 * AudioContext: the page keeps exactly one context, Howler's.
 * `tests/howler-entry.test.ts` and `scripts/smoke-imports.mjs` fail if a Tone
 * import ever enters this module graph.
 *
 * The lifecycle functions here have the same names and contract as the ones in
 * the root entry point, but unlock Howler's AudioContext instead of Tone's.
 * Use one entry point or the other in an application, never both.
 *
 * Not included because it is Tone-coupled: the Tone bus graph (`buildBuses`
 * and friends) and the preferences bridge, which drives that bus graph. Mirror
 * volume and mute into the resolver directly with `setResolverVolume`,
 * `setResolverMute` and `setResolverMasterBus`.
 */

// Gesture-gated lifecycle (Howler's AudioContext)
export {
  _resetAudioEngine,
  isAudioEngineStarted,
  registerAudioGestureTrigger,
  startAudioEngine,
} from './howler-unlock.js';

// Howler sprite resolver
export type {
  AudioPosition,
  NestedSpriteMap,
  PannerOptions,
  PlayCueOptions,
  SpriteEntry,
  SpriteMap,
  SpriteResolverOptions,
} from './sprite-resolver.js';
export {
  _getCueMap,
  _getLastResolverOptions,
  disposeSpriteResolver,
  fadeCue,
  initSpriteResolver,
  pauseCue,
  playCue,
  resumeCue,
  setAudioListener,
  setCueGain,
  setCuePosition,
  setResolverMasterBus,
  setResolverMute,
  setResolverVolume,
  stopCue,
} from './sprite-resolver.js';
