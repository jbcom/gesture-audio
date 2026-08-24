/**
 * Tone.js bus topology.
 *
 * Architecture (for a typical game with buses ['master','music','sfx','voice','crowd']):
 *   [music]    ──┐
 *   [sfx]      ──┤
 *   [voice]    ──┼── [master] ── [limiter] ── output
 *   [crowd]    ──┘
 *
 * Each non-master bus is a Tone.Gain routed to the master Gain.
 * The master routes through a Limiter (-1 dBFS) before device output.
 * Bus names are caller-supplied — the graph makes no assumption about
 * how many buses exist or what they're called, beyond the first name
 * in the array being treated as the master/root bus.
 */

import * as Tone from 'tone';

/**
 * A single named bus in the topology — a Tone.js Gain node plus the mute
 * flag `muteBus`/`setBusVolume` use to distinguish "silenced but a volume
 * is still remembered" from the gain actually being zero.
 */
export interface Bus {
  /** The underlying Tone.js gain node this bus routes audio through. */
  gain: Tone.Gain;
  /** Whether the bus is currently muted (see `muteBus`). */
  muted: boolean;
}

/**
 * The full bus topology returned by `buildBuses`/`getBuses`: one `Bus` per
 * caller-supplied name (keyed by the same string literal union `B`), plus
 * the shared `limiter` every bus ultimately routes through before output.
 */
export type AudioBuses<B extends string> = Record<B, Bus> & { limiter: Tone.Limiter };

let _buses: AudioBuses<string> | null = null;
let _masterName: string | null = null;
let _busNames: readonly string[] = [];
const _configuredVolumes = new Map<string, number>();
const _muteReasons = new Map<string, Set<string>>();
const _duckStates = new Map<
  string,
  { factor: number; timer: ReturnType<typeof setTimeout> | null }
>();

const MANUAL_MUTE_REASON = 'manual';

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`);
}

function validateBusNames(names: readonly string[]): void {
  if (names.length === 0) {
    throw new Error('buildBuses() requires at least one bus name (the first is the master bus)');
  }
  const seen = new Set<string>();
  for (const name of names) {
    if (typeof name !== 'string') throw new TypeError('Audio bus names must be strings');
    if (name.trim().length === 0) throw new Error('Audio bus names must not be empty');
    if (name === 'limiter') throw new Error('"limiter" is reserved for the output limiter node');
    if (seen.has(name)) throw new Error(`Duplicate audio bus name: ${name}`);
    seen.add(name);
  }
}

function applyEffectiveGain(bus: string, rampSeconds: number): void {
  const current = _buses?.[bus];
  if (!current) return;
  const muted = (_muteReasons.get(bus)?.size ?? 0) > 0;
  current.muted = muted;
  const duckFactor = _duckStates.get(bus)?.factor ?? 1;
  const value = muted ? 0 : (_configuredVolumes.get(bus) ?? 1) * duckFactor;
  if (rampSeconds > 0) current.gain.gain.rampTo(value, rampSeconds);
  else current.gain.gain.setValueAtTime(value, Tone.now());
}

/**
 * Build and wire a Tone.js bus topology from a list of bus names.
 * The FIRST name in `names` is treated as the master/root bus — every
 * other bus's Gain node connects into it, and the master connects through
 * a Limiter(-1) to destination.
 *
 * Must be called after user gesture (Tone.start() already awaited).
 * Idempotent — returns existing buses if already built.
 */
export function buildBuses<B extends string>(names: readonly B[]): AudioBuses<B> {
  validateBusNames(names);
  if (_buses) {
    if (
      names.length !== _busNames.length ||
      names.some((name, index) => name !== _busNames[index])
    ) {
      throw new Error(
        `Audio buses are already built as [${_busNames.join(', ')}]; disposeBuses() before building a different topology`,
      );
    }
    return _buses as AudioBuses<B>;
  }

  const [masterName, ...subNames] = names as [B, ...B[]];
  const limiter = new Tone.Limiter(-1).toDestination();
  const masterGain = new Tone.Gain(1).connect(limiter);

  const busMap = Object.create(null) as Record<string, Bus>;
  busMap[masterName] = { gain: masterGain, muted: false };
  _configuredVolumes.set(masterName, 1);

  for (const name of subNames) {
    const gain = new Tone.Gain(1).connect(masterGain);
    busMap[name] = { gain, muted: false };
    _configuredVolumes.set(name, 1);
  }

  const typedBuses = { ...busMap, limiter } as AudioBuses<B>;
  _buses = typedBuses;
  _masterName = masterName;
  _busNames = [...names];
  return typedBuses;
}

/**
 * Get the current bus topology (must call buildBuses first).
 */
export function getBuses<B extends string>(): AudioBuses<B> {
  if (!_buses) throw new Error('Audio buses not built — call buildBuses() after user gesture');
  return _buses as AudioBuses<B>;
}

/**
 * Set the linear gain of a named bus.
 * @param bus     - bus name (must be one passed to buildBuses)
 * @param linear  - 0–1 linear amplitude (preferences 0–100 → divide by 100)
 * @param rampMs  - optional smooth ramp in ms (default 50ms)
 */
export function setBusVolume<B extends string>(bus: B, linear: number, rampMs = 50): void {
  if (!_buses) return;
  const b = _buses[bus];
  if (!b) return;
  assertFinite(linear, 'linear');
  assertFinite(rampMs, 'rampMs');
  if (rampMs < 0) throw new RangeError('rampMs must be greater than or equal to 0');
  const clamped = Math.max(0, Math.min(1, linear));
  _configuredVolumes.set(bus, clamped);
  applyEffectiveGain(bus, rampMs / 1000);
}

/**
 * Mute or unmute a named bus.
 * Ramps to 0 / restores to stored level over 30ms to avoid clicks.
 */
export function muteBus<B extends string>(bus: B, mute: boolean): void {
  _setBusMuteReason(bus, MANUAL_MUTE_REASON, mute);
}

/** @internal Apply an independently reversible mute layer. */
export function _setBusMuteReason<B extends string>(bus: B, reason: string, mute: boolean): void {
  if (!_buses) return;
  const b = _buses[bus];
  if (!b) return;
  if (reason.length === 0) throw new Error('Mute reason must not be empty');
  const reasons = _muteReasons.get(bus) ?? new Set<string>();
  if (mute) reasons.add(reason);
  else reasons.delete(reason);
  if (reasons.size > 0) _muteReasons.set(bus, reasons);
  else _muteReasons.delete(bus);
  applyEffectiveGain(bus, 0.03);
}

/**
 * Duck a bus by a dB amount, with optional duration.
 * When duration expires, gain is restored.
 * Used for narration/SFX ducking rules.
 */
export function duckBus<B extends string>(bus: B, duckDb: number, durationMs?: number): void {
  if (!_buses) return;
  const b = _buses[bus];
  if (!b || b.muted) return;
  assertFinite(duckDb, 'duckDb');
  if (duckDb > 0) throw new RangeError('duckDb must be 0 or negative');
  if (durationMs !== undefined) {
    assertFinite(durationMs, 'durationMs');
    if (durationMs < 0) throw new RangeError('durationMs must be greater than or equal to 0');
  }
  const previous = _duckStates.get(bus);
  if (previous?.timer) clearTimeout(previous.timer);
  const state = {
    factor: Tone.dbToGain(duckDb),
    timer: null as ReturnType<typeof setTimeout> | null,
  };
  _duckStates.set(bus, state);
  applyEffectiveGain(bus, 0.05);
  if (durationMs !== undefined) {
    state.timer = setTimeout(() => {
      if (_duckStates.get(bus) !== state) return;
      _duckStates.delete(bus);
      applyEffectiveGain(bus, 0.1);
    }, durationMs);
  }
}

/**
 * Tear down buses (called on app unmount / test cleanup).
 */
export function disposeBuses(): void {
  if (!_buses) return;
  for (const state of _duckStates.values()) {
    if (state.timer) clearTimeout(state.timer);
  }
  for (const [name, bus] of Object.entries(_buses)) {
    if (name === 'limiter') continue;
    (bus as Bus).gain.dispose();
  }
  _buses.limiter.dispose();
  _buses = null;
  _masterName = null;
  _busNames = [];
  _configuredVolumes.clear();
  _muteReasons.clear();
  _duckStates.clear();
}

/** Exposed for testing / introspection. */
export function _getMasterBusName(): string | null {
  return _masterName;
}
