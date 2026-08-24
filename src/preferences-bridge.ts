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

import { _setBusMuteReason, muteBus, setBusVolume } from './buses.js';
import { _setResolverMuteReason, setResolverMute, setResolverVolume } from './sprite-resolver.js';

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

const FOCUS_MUTE_REASON = 'focus-loss';
const PREFERENCE_MUTE_REASON = 'preferences-mute-all';

function normalizeVolume100(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`);
  return Math.round(Math.max(0, Math.min(100, value)));
}

function validateDefaultVolume(value: number): number {
  return normalizeVolume100(value, 'defaultVolume100');
}

function validateSnapshot(value: AudioPrefsSnapshot): AudioPrefsSnapshot {
  if (
    !value ||
    typeof value !== 'object' ||
    !value.audioVolumes ||
    typeof value.audioVolumes !== 'object' ||
    Array.isArray(value.audioVolumes)
  ) {
    throw new TypeError('AudioPrefsStore.get() must return an object with an audioVolumes map');
  }
  return value;
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
  const prefs = validateSnapshot(await store.get());
  const { audioVolumes } = prefs;
  const fallback = validateDefaultVolume(defaultVolume100);

  for (const bus of busNames) {
    const vol = normalizeVolume100(audioVolumes[bus] ?? fallback, `audioVolumes.${bus}`) / 100;
    setBusVolume(bus, vol, 0); // instant on startup — no ramp
    setResolverVolume(bus, vol);
  }

  registerFocusLossMute(Boolean(prefs.muteOnFocusLoss), store, busNames);
  _setMuteReasonForAll(busNames, PREFERENCE_MUTE_REASON, Boolean(prefs.muteAll));
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
  const persisted = normalizeVolume100(vol100, 'vol100');
  const linear = persisted / 100;
  const prefs = validateSnapshot(await store.get());
  const previous = normalizeVolume100(prefs.audioVolumes[bus] ?? 75, `audioVolumes.${bus}`) / 100;
  setBusVolume(bus, linear);
  setResolverVolume(bus, linear);

  try {
    await store.update({ audioVolumes: { ...prefs.audioVolumes, [bus]: persisted } });
  } catch (error) {
    setBusVolume(bus, previous);
    setResolverVolume(bus, previous);
    throw error;
  }
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
  const prefs = validateSnapshot(await store.get());
  const fallback = validateDefaultVolume(defaultVolume100);
  const normalizedPatch = Object.fromEntries(
    Object.entries(audioVolumes).map(([bus, value]) => [
      bus,
      normalizeVolume100(value, `audioVolumes.${bus}`),
    ]),
  );
  const merged = { ...prefs.audioVolumes, ...normalizedPatch };
  const previousVolumes = new Map<string, number>();

  for (const bus of busNames) {
    previousVolumes.set(
      bus,
      normalizeVolume100(prefs.audioVolumes[bus] ?? fallback, `audioVolumes.${bus}`) / 100,
    );
    const vol = normalizeVolume100(merged[bus] ?? fallback, `audioVolumes.${bus}`) / 100;
    setBusVolume(bus, vol);
    setResolverVolume(bus, vol);
  }

  try {
    await store.update({ audioVolumes: merged });
  } catch (error) {
    for (const [bus, volume] of previousVolumes) {
      setBusVolume(bus, volume);
      setResolverVolume(bus, volume);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Focus-loss mute
// ---------------------------------------------------------------------------

let _focusListenersRegistered = false;
let _focusBlurHandler: (() => void) | null = null;
let _focusRestoreHandler: (() => void) | null = null;
let _focusBusNames: readonly string[] = [];

function _setMuteReasonForAll(busNames: readonly string[], reason: string, muted: boolean): void {
  for (const bus of busNames) {
    _setBusMuteReason(bus, reason, muted);
    _setResolverMuteReason(bus, reason, muted);
  }
}

/**
 * Register (or tear down) window blur/focus listeners that apply an independent
 * focus-loss mute layer while the tab/app is backgrounded. Focus or teardown
 * always removes only that layer, preserving manual/global mutes.
 *
 * @param enabled - true to register, false to remove existing listeners
 * @param store   - required when enabled=true for API compatibility with the preference bridge
 * @param busNames - buses to mute/unmute; required when enabled=true
 */
export function registerFocusLossMute(
  enabled: boolean,
  store?: AudioPrefsStore,
  busNames?: readonly string[],
): void {
  if (!enabled) {
    _setMuteReasonForAll(_focusBusNames, FOCUS_MUTE_REASON, false);
    if (_focusListenersRegistered && typeof window !== 'undefined') {
      if (_focusBlurHandler) window.removeEventListener('blur', _focusBlurHandler);
      if (_focusRestoreHandler) window.removeEventListener('focus', _focusRestoreHandler);
    }
    _focusListenersRegistered = false;
    _focusBlurHandler = null;
    _focusRestoreHandler = null;
    _focusBusNames = [];
    return;
  }

  if (typeof window === 'undefined' || !store || !busNames || busNames.length === 0) return;
  if (_focusListenersRegistered) {
    const unchanged =
      busNames.length === _focusBusNames.length &&
      busNames.every((name, index) => name === _focusBusNames[index]);
    if (unchanged) return;
    registerFocusLossMute(false);
  }
  _focusListenersRegistered = true;
  _focusBusNames = [...busNames];

  _focusBlurHandler = () => _setMuteReasonForAll(_focusBusNames, FOCUS_MUTE_REASON, true);
  _focusRestoreHandler = () => _setMuteReasonForAll(_focusBusNames, FOCUS_MUTE_REASON, false);

  window.addEventListener('blur', _focusBlurHandler);
  window.addEventListener('focus', _focusRestoreHandler);
}
