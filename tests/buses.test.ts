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

import { buildBuses, disposeBuses, duckBus, getBuses, muteBus, setBusVolume } from '../src';

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

  it('supports an arbitrary caller-chosen bus set (not hardcoded names)', () => {
    disposeBuses();
    const buses = buildBuses(['root', 'ambience', 'ui'] as const);
    expect(buses.root).toBeDefined();
    expect(buses.ambience).toBeDefined();
    expect(buses.ui).toBeDefined();
    expect(buses.ambience.gain.connect).toHaveBeenCalled();
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

  it('instant set when rampMs=0 uses setValueAtTime', () => {
    setBusVolume('voice', 0.3, 0);
    const buses = getBuses<(typeof BUS_NAMES)[number]>();
    expect(buses.voice.gain.gain.value).toBe(0.3);
  });

  it('no-ops for an unknown bus name', () => {
    expect(() => setBusVolume('does-not-exist', 0.5)).not.toThrow();
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
});
