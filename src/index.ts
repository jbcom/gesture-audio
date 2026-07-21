/**
 * @arcade-cabinet/audio-engine — public API.
 *
 * Tone.js owns the bus graph (master → limiter → destination, plus caller-
 * named sub-buses). Howler owns sample playback purely as a sprite-based
 * sample player. A thin preferences-bridge wires a caller-supplied prefs
 * store + blur/focus mute-on-background into both.
 *
 * Import from here, not from sub-modules directly.
 */

// Bus topology (Tone.js)
export {
  type AudioBuses,
  type Bus,
  buildBuses,
  disposeBuses,
  duckBus,
  getBuses,
  muteBus,
  setBusVolume,
  _getMasterBusName,
} from './buses.js';

// Gesture-gated lifecycle
export {
  isAudioEngineStarted,
  registerAudioGestureTrigger,
  startAudioEngine,
  _resetAudioEngine,
} from './init.js';

// Preferences bridge
export type { AudioPrefsSnapshot, AudioPrefsStore } from './preferences-bridge.js';
export {
  applyPersistedAudioPrefs,
  registerFocusLossMute,
  setAndPersistBusMute,
  setAndPersistBusVolume,
  syncAudioPrefsFromSettings,
} from './preferences-bridge.js';

// Howler sprite resolver
export type {
  NestedSpriteMap,
  SpriteEntry,
  SpriteMap,
  SpriteResolverOptions,
} from './sprite-resolver.js';
export {
  disposeSpriteResolver,
  initSpriteResolver,
  playCue,
  setResolverMasterBus,
  setResolverMute,
  setResolverVolume,
  stopCue,
  _getCueMap,
  _getLastResolverOptions,
} from './sprite-resolver.js';
