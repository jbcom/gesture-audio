/**
 * Audio preferences bridge.
 *
 * Wires a caller-supplied preferences store to the Tone.js bus topology and
 * Howler sprite resolver. The store only needs to satisfy the minimal
 * `AudioPrefsStore` shape below — it is NOT coupled to any specific
 * persistence manager singleton.
 *
 * Volume mapping: preferences store 0–100 int; buses expect 0–1 linear.
 */

import { muteBus, setBusVolume } from './buses.js';
import { setResolverMute, setResolverVolume } from './sprite-resolver.js';

export interface AudioPrefsSnapshot {
  /** bus name → 0–100 int volume */
  audioVolumes: Record<string, number>;
  /** whether to auto-mute all buses on window blur / restore on focus */
  muteOnFocusLoss?: boolean;
  /** whether to mute all buses right now (e.g. reduced-motion / screen-reader mode) */
  muteAll?: boolean;
}

/**
 * Minimal store contract the bridge needs. Matches the shape of most
 * async preference managers (get() returns current snapshot; update()
 * patches and persists a partial).
 */
export interface AudioPrefsStore {
  get(): Promise<AudioPrefsSnapshot>;
  update(patch: { audioVolumes: Record<string, number> }): Promise<void>;
}

/**
 * Apply persisted audio preferences to the live audio engine.
 * Call once on startup after buses are built and user gesture received.
 *
 * @param store    - the preferences store to read from
 * @param busNames - buses to apply volume to (must match buildBuses() names)
 * @param defaultVolume100 - fallback volume (0–100) for buses missing from the store
 */
export async function applyPersistedAudioPrefs(
  store: AudioPrefsStore,
  busNames: readonly string[],
  defaultVolume100 = 75,
): Promise<void> {
  const prefs = await store.get();
  const { audioVolumes } = prefs;

  for (const bus of busNames) {
    const vol = (audioVolumes[bus] ?? defaultVolume100) / 100;
    setBusVolume(bus, vol, 0); // instant on startup — no ramp
    setResolverVolume(bus, vol);
  }

  if (prefs.muteOnFocusLoss) {
    registerFocusLossMute(true, store, busNames);
  }

  if (prefs.muteAll) {
    _muteAll(busNames, true);
  }
}

/**
 * Persist volume change for a bus and apply to live audio.
 * Called by the Settings panel sliders.
 *
 * @param bus    - bus name
 * @param vol100 - volume 0–100 (as stored in preferences)
 * @param store  - the preferences store to persist to
 */
export async function setAndPersistBusVolume(
  bus: string,
  vol100: number,
  store: AudioPrefsStore,
): Promise<void> {
  const linear = Math.max(0, Math.min(100, vol100)) / 100;
  setBusVolume(bus, linear);
  setResolverVolume(bus, linear);

  const prefs = await store.get();
  await store.update({
    audioVolumes: { ...prefs.audioVolumes, [bus]: Math.round(vol100) },
  });
}

/**
 * Set mute state for a bus and apply to live audio.
 * Mute state is runtime-only here — persist it via the store's own shape
 * (e.g. storing volume=0) if the caller wants it to survive reload.
 */
export function setAndPersistBusMute(bus: string, muted: boolean): void {
  muteBus(bus, muted);
  setResolverMute(bus, muted);
}

/**
 * Merge and apply a full (or partial) audioVolumes map, persisting the merge.
 * Used when a Settings panel sends multiple changed sliders at once.
 */
export async function syncAudioPrefsFromSettings(
  audioVolumes: Record<string, number>,
  busNames: readonly string[],
  store: AudioPrefsStore,
  defaultVolume100 = 75,
): Promise<void> {
  const prefs = await store.get();
  const merged = { ...prefs.audioVolumes, ...audioVolumes };

  for (const bus of busNames) {
    const vol = (merged[bus] ?? defaultVolume100) / 100;
    setBusVolume(bus, vol);
    setResolverVolume(bus, vol);
  }

  await store.update({ audioVolumes: merged });
}

// ---------------------------------------------------------------------------
// Focus-loss mute
// ---------------------------------------------------------------------------

let _focusListenersRegistered = false;
let _focusBlurHandler: (() => void) | null = null;
let _focusRestoreHandler: (() => void) | null = null;

function _muteAll(busNames: readonly string[], muted: boolean): void {
  for (const bus of busNames) {
    muteBus(bus, muted);
    setResolverMute(bus, muted);
  }
}

/**
 * Register (or tear down) window blur/focus listeners that mute all buses
 * while the tab/app is backgrounded, restoring on focus IF the store still
 * reports `muteOnFocusLoss: true` at that time.
 *
 * @param enabled - true to register, false to remove existing listeners
 * @param store   - required when enabled=true (re-checked on focus)
 * @param busNames - buses to mute/unmute; required when enabled=true
 */
export function registerFocusLossMute(
  enabled: boolean,
  store?: AudioPrefsStore,
  busNames?: readonly string[],
): void {
  if (!enabled) {
    if (_focusListenersRegistered && typeof window !== 'undefined') {
      if (_focusBlurHandler) window.removeEventListener('blur', _focusBlurHandler);
      if (_focusRestoreHandler) window.removeEventListener('focus', _focusRestoreHandler);
    }
    _focusListenersRegistered = false;
    _focusBlurHandler = null;
    _focusRestoreHandler = null;
    return;
  }

  if (_focusListenersRegistered || typeof window === 'undefined' || !store || !busNames) return;
  _focusListenersRegistered = true;

  _focusBlurHandler = () => _muteAll(busNames, true);
  _focusRestoreHandler = () => {
    store
      .get()
      .then((prefs) => {
        if (prefs.muteOnFocusLoss) {
          _muteAll(busNames, false);
        }
      })
      .catch(() => {
        console.warn('[audio-engine/preferences] Could not restore focus-loss mute state');
      });
  };

  window.addEventListener('blur', _focusBlurHandler);
  window.addEventListener('focus', _focusRestoreHandler);
}
