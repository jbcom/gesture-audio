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

export interface Bus {
  gain: Tone.Gain;
  muted: boolean;
}

export type AudioBuses<B extends string> = Record<B, Bus> & { limiter: Tone.Limiter };

let _buses: AudioBuses<string> | null = null;
let _masterName: string | null = null;

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
  if (_buses) return _buses as AudioBuses<B>;
  if (names.length === 0) {
    throw new Error('buildBuses() requires at least one bus name (the first is the master bus)');
  }

  const [masterName, ...subNames] = names as [B, ...B[]];
  const limiter = new Tone.Limiter(-1).toDestination();
  const masterGain = new Tone.Gain(1).connect(limiter);

  const busMap: Record<string, Bus> = {
    [masterName]: { gain: masterGain, muted: false },
  };

  for (const name of subNames) {
    const gain = new Tone.Gain(1).connect(masterGain);
    busMap[name] = { gain, muted: false };
  }

  const typedBuses = { ...busMap, limiter } as AudioBuses<B>;
  _buses = typedBuses;
  _masterName = masterName;
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
  const clamped = Math.max(0, Math.min(1, linear));
  if (rampMs > 0) {
    b.gain.gain.rampTo(clamped, rampMs / 1000);
  } else {
    b.gain.gain.setValueAtTime(clamped, Tone.now());
  }
}

/**
 * Mute or unmute a named bus.
 * Ramps to 0 / restores to stored level over 30ms to avoid clicks.
 */
export function muteBus<B extends string>(bus: B, mute: boolean): void {
  if (!_buses) return;
  const b = _buses[bus];
  if (!b) return;
  b.muted = mute;
  b.gain.gain.rampTo(mute ? 0 : b.gain.gain.value, 0.03);
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
  const current = b.gain.gain.value;
  const ducked = current * Tone.dbToGain(duckDb);
  b.gain.gain.rampTo(ducked, 0.05);
  if (durationMs !== undefined) {
    setTimeout(() => {
      if (!_buses) return;
      const bb = _buses[bus];
      if (bb && !bb.muted) {
        bb.gain.gain.rampTo(current, 0.1);
      }
    }, durationMs);
  }
}

/**
 * Tear down buses (called on app unmount / test cleanup).
 */
export function disposeBuses(): void {
  if (!_buses) return;
  for (const [name, bus] of Object.entries(_buses)) {
    if (name === 'limiter') continue;
    (bus as Bus).gain.dispose();
  }
  _buses.limiter.dispose();
  _buses = null;
  _masterName = null;
}

/** Exposed for testing / introspection. */
export function _getMasterBusName(): string | null {
  return _masterName;
}
