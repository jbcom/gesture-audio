/**
 * Tests: src/buses.ts
 *
 * Mocks Tone.js using class factories inside vi.mock (Vitest hoisting-safe).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  gainInstances: [] as Array<{
    gainValue: number;
    rampToCalls: Array<[number, number]>;
    setValueAtTimeCalls: Array<[number, number]>;
    connectCalled: boolean;
  }>,
}));

vi.mock('tone', () => {
  const s = state;

  class MockGain {
    gain: {
      value: number;
      rampTo: (val: number, ramp: number) => void;
      setValueAtTime: (val: number, time: number) => void;
    };
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    toDestination: ReturnType<typeof vi.fn>;

    constructor() {
      const record = {
        gainValue: 1,
        rampToCalls: [] as Array<[number, number]>,
        setValueAtTimeCalls: [] as Array<[number, number]>,
        connectCalled: false,
      };
      s.gainInstances.push(record);
      this.gain = {
        get value() {
          return record.gainValue;
        },
        set value(v: number) {
          record.gainValue = v;
        },
        rampTo: (val: number, ramp: number) => {
          record.gainValue = val;
          record.rampToCalls.push([val, ramp]);
        },
        setValueAtTime: (val: number, time: number) => {
          record.gainValue = val;
          record.setValueAtTimeCalls.push([val, time]);
        },
      };
      this.connect = vi.fn(() => this);
      this.disconnect = vi.fn();
      this.dispose = vi.fn();
      this.toDestination = vi.fn(() => this);
    }
  }

  class MockLimiter {
    connect = vi.fn(() => this);
    disconnect = vi.fn();
    dispose = vi.fn();
    toDestination = vi.fn(() => this);
  }

  return {
    Gain: MockGain,
    Limiter: MockLimiter,
    now: vi.fn(() => 0),
    dbToGain: (db: number) => 10 ** (db / 20),
    start: vi.fn().mockResolvedValue(undefined),
  };
});

import {
  _getMasterBusName,
  buildBuses,
  disposeBuses,
  duckBus,
  getBuses,
  muteBus,
  setBusVolume,
} from '../src';

const BUS_NAMES = ['master', 'music', 'sfx', 'voice', 'crowd'] as const;

function clearState() {
  state.gainInstances.length = 0;
}

describe('buildBuses', () => {
  beforeEach(() => {
    clearState();
    disposeBuses();
  });
  afterEach(() => {
    disposeBuses();
  });

  it('returns bus topology for every requested bus name + limiter', () => {
    const buses = buildBuses(BUS_NAMES);
    expect(buses.master).toBeDefined();
    expect(buses.music).toBeDefined();
    expect(buses.sfx).toBeDefined();
    expect(buses.voice).toBeDefined();
    expect(buses.crowd).toBeDefined();
    expect(buses.limiter).toBeDefined();
  });

  it('is idempotent — second call returns same object', () => {
    const a = buildBuses(BUS_NAMES);
    const b = buildBuses(BUS_NAMES);
    expect(a).toBe(b);
  });

  it('connects each sub-bus gain to master', () => {
    const buses = buildBuses(BUS_NAMES);
    expect(buses.music.gain.connect).toHaveBeenCalled();
    expect(buses.sfx.gain.connect).toHaveBeenCalled();
    expect(buses.voice.gain.connect).toHaveBeenCalled();
    expect(buses.crowd.gain.connect).toHaveBeenCalled();
  });

  it('getBuses throws before buildBuses is called', () => {
    expect(() => getBuses()).toThrow();
  });

  it('throws if given an empty bus-name list', () => {
    expect(() => buildBuses([])).toThrow();
  });

  it('rejects empty, duplicate, and reserved bus names', () => {
    expect(() => buildBuses(['master', ''])).toThrow(/must not be empty/);
    expect(() => buildBuses(['master', 'master'])).toThrow(/Duplicate/);
    expect(() => buildBuses(['master', 'limiter'])).toThrow(/reserved/);
  });

  it('rejects a different topology until the existing graph is disposed', () => {
    buildBuses(BUS_NAMES);
    expect(() => buildBuses(['root', 'ui'] as const)).toThrow(/disposeBuses/);
  });

  it('supports an arbitrary caller-chosen bus set (not hardcoded names)', () => {
    disposeBuses();
    const buses = buildBuses(['root', 'ambience', 'ui'] as const);
    expect(buses.root).toBeDefined();
    expect(buses.ambience).toBeDefined();
    expect(buses.ui).toBeDefined();
    expect(buses.ambience.gain.connect).toHaveBeenCalled();
  });

  it('treats prototype-like names as ordinary own bus keys', () => {
    disposeBuses();
    const buses = buildBuses(['__proto__', 'constructor'] as const);
    expect(Object.hasOwn(buses, '__proto__')).toBe(true);
    expect(Object.hasOwn(buses, 'constructor')).toBe(true);
  });
});

describe('setBusVolume', () => {
  beforeEach(() => {
    clearState();
    disposeBuses();
    buildBuses(BUS_NAMES);
  });
  afterEach(() => disposeBuses());

  it('ramps master bus gain to given value', () => {
    setBusVolume('master', 0.5);
    const buses = getBuses<(typeof BUS_NAMES)[number]>();
    expect(buses.master.gain.gain.value).toBe(0.5);
  });

  it('ramps sfx bus gain', () => {
    setBusVolume('sfx', 0.8);
    const buses = getBuses<(typeof BUS_NAMES)[number]>();
    expect(buses.sfx.gain.gain.value).toBe(0.8);
  });

  it('clamps gain to 1 for values above 1', () => {
    setBusVolume('music', 2.0);
    const buses = getBuses<(typeof BUS_NAMES)[number]>();
    expect(buses.music.gain.gain.value).toBe(1);
  });

  it('clamps gain to 0 for negative values', () => {
    setBusVolume('music', -0.5);
    const buses = getBuses<(typeof BUS_NAMES)[number]>();
    expect(buses.music.gain.gain.value).toBe(0);
  });

  it('rejects non-finite values and negative ramps', () => {
    expect(() => setBusVolume('music', Number.NaN)).toThrow(/finite/);
    expect(() => setBusVolume('music', 0.5, -1)).toThrow(/rampMs/);
  });

  it('instant set when rampMs=0 uses setValueAtTime', () => {
    setBusVolume('voice', 0.3, 0);
    const buses = getBuses<(typeof BUS_NAMES)[number]>();
    expect(buses.voice.gain.gain.value).toBe(0.3);
  });

  it('no-ops for an unknown bus name', () => {
    expect(() => setBusVolume('does-not-exist', 0.5)).not.toThrow();
  });

  it('no-ops for an unregistered name that collides with an inherited Object.prototype member', () => {
    // The bus map is `{ ...busMap, limiter }` — a plain object literal, so
    // it inherits from Object.prototype. A name like "toString" or
    // "constructor" must not resolve to the inherited function.
    expect(() => setBusVolume('toString', 0.5)).not.toThrow();
    expect(() => setBusVolume('constructor', 0.5)).not.toThrow();
  });

  it('no-ops when called before buildBuses()', () => {
    disposeBuses();
    expect(() => setBusVolume('master', 0.5)).not.toThrow();
    buildBuses(BUS_NAMES);
  });
});

describe('muteBus', () => {
  beforeEach(() => {
    clearState();
    disposeBuses();
    buildBuses(BUS_NAMES);
  });
  afterEach(() => disposeBuses());

  it('sets muted flag to true', () => {
    muteBus('crowd', true);
    const buses = getBuses<(typeof BUS_NAMES)[number]>();
    expect(buses.crowd.muted).toBe(true);
  });

  it('clears muted flag on unmute', () => {
    muteBus('crowd', true);
    muteBus('crowd', false);
    const buses = getBuses<(typeof BUS_NAMES)[number]>();
    expect(buses.crowd.muted).toBe(false);
  });

  it('muting ramps gain to 0', () => {
    muteBus('sfx', true);
    const buses = getBuses<(typeof BUS_NAMES)[number]>();
    expect(buses.sfx.gain.gain.value).toBe(0);
  });

  it('unmuting restores the configured gain instead of the muted zero', () => {
    setBusVolume('sfx', 0.35, 0);
    muteBus('sfx', true);
    muteBus('sfx', false);

    const buses = getBuses<(typeof BUS_NAMES)[number]>();
    expect(buses.sfx.gain.gain.value).toBe(0.35);
  });

  it('remembers volume changes made while muted without making them audible', () => {
    muteBus('music', true);
    setBusVolume('music', 0.65, 0);

    const buses = getBuses<(typeof BUS_NAMES)[number]>();
    expect(buses.music.gain.gain.value).toBe(0);

    muteBus('music', false);
    expect(buses.music.gain.gain.value).toBe(0.65);
  });

  it('no-ops for an unknown bus name', () => {
    expect(() => muteBus('does-not-exist', true)).not.toThrow();
  });

  it('no-ops when called before buildBuses()', () => {
    disposeBuses();
    expect(() => muteBus('crowd', true)).not.toThrow();
    buildBuses(BUS_NAMES);
  });
});

describe('duckBus', () => {
  beforeEach(() => {
    clearState();
    disposeBuses();
    buildBuses(BUS_NAMES);
  });
  afterEach(() => disposeBuses());

  it('ducks bus gain (reduces from 1)', () => {
    duckBus('music', -6);
    const buses = getBuses<(typeof BUS_NAMES)[number]>();
    expect(buses.music.gain.gain.value).toBeLessThan(1);
  });

  it('no-ops if bus is muted', () => {
    muteBus('music', true);
    const buses = getBuses<(typeof BUS_NAMES)[number]>();
    const gainAfterMute = buses.music.gain.gain.value;
    duckBus('music', -6);
    expect(buses.music.gain.gain.value).toBe(gainAfterMute);
  });

  it('restores the configured level after durationMs elapses', () => {
    vi.useFakeTimers();
    try {
      setBusVolume('music', 0.8, 0);
      duckBus('music', -6, 200);
      const buses = getBuses<(typeof BUS_NAMES)[number]>();
      expect(buses.music.gain.gain.value).toBeLessThan(0.8);

      vi.advanceTimersByTime(200);

      expect(buses.music.gain.gain.value).toBeCloseTo(0.8);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a changed configured volume attenuated until ducking ends', () => {
    vi.useFakeTimers();
    try {
      duckBus('music', -6, 200);
      setBusVolume('music', 0.4, 0);
      const buses = getBuses<(typeof BUS_NAMES)[number]>();
      expect(buses.music.gain.gain.value).toBeLessThan(0.4);
      vi.advanceTimersByTime(200);
      expect(buses.music.gain.gain.value).toBeCloseTo(0.4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('replaces an earlier timed duck instead of allowing a stale restore', () => {
    vi.useFakeTimers();
    try {
      duckBus('music', -6, 100);
      vi.advanceTimersByTime(50);
      duckBus('music', -12, 200);
      vi.advanceTimersByTime(50);
      const buses = getBuses<(typeof BUS_NAMES)[number]>();
      expect(buses.music.gain.gain.value).toBeLessThan(0.5);
      vi.advanceTimersByTime(150);
      expect(buses.music.gain.gain.value).toBeCloseTo(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects amplification and invalid durations', () => {
    expect(() => duckBus('music', 3)).toThrow(/duckDb/);
    expect(() => duckBus('music', -6, -1)).toThrow(/durationMs/);
  });

  it('does not restore a bus that was muted before the restore timer fires', () => {
    vi.useFakeTimers();
    try {
      setBusVolume('music', 0.8, 0);
      duckBus('music', -6, 200);
      muteBus('music', true);
      const buses = getBuses<(typeof BUS_NAMES)[number]>();
      const mutedValue = buses.music.gain.gain.value;

      vi.advanceTimersByTime(200);

      // Restore is skipped because the bus is muted by the time the timer fires.
      expect(buses.music.gain.gain.value).toBe(mutedValue);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is a no-op after disposeBuses() even if a restore timer is still pending', () => {
    vi.useFakeTimers();
    try {
      duckBus('music', -6, 200);
      disposeBuses();
      expect(() => vi.advanceTimersByTime(200)).not.toThrow();
    } finally {
      vi.useRealTimers();
      buildBuses(BUS_NAMES);
    }
  });

  it('no-ops when called before buildBuses()', () => {
    disposeBuses();
    expect(() => duckBus('music', -6)).not.toThrow();
    buildBuses(BUS_NAMES);
  });
});

describe('_getMasterBusName', () => {
  afterEach(() => {
    disposeBuses();
    buildBuses(BUS_NAMES);
  });

  it('returns the first bus name passed to buildBuses', () => {
    disposeBuses();
    buildBuses(BUS_NAMES);
    expect(_getMasterBusName()).toBe(BUS_NAMES[0]);
  });

  it('returns null before buildBuses() has been called / after disposeBuses()', () => {
    disposeBuses();
    expect(_getMasterBusName()).toBeNull();
  });
});
