/**
 * tests/preferences-bridge.test.ts — volume propagation from a caller-supplied
 * AudioPrefsStore.
 *
 * Verifies that:
 *   - setAndPersistBusVolume applies to both Tone buses and Howler resolver
 *   - syncAudioPrefsFromSettings applies a full audioVolumes map
 *   - applyPersistedAudioPrefs reads stored values and applies them on startup
 *   - muteAll (the caller's own accessibility/reduced-motion signal) mutes all buses
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const busState = vi.hoisted(() => ({
  setBusVolumeCalls: [] as Array<[string, number, number?]>,
  muteBusCalls: [] as Array<[string, boolean]>,
  resolverVolumeCalls: [] as Array<[string, number]>,
  resolverMuteCalls: [] as Array<[string, boolean]>,
}));

vi.mock('../src/buses', () => {
  const s = busState;
  return {
    setBusVolume: vi.fn((bus: string, vol: number, ramp?: number) => {
      s.setBusVolumeCalls.push([bus, vol, ramp]);
    }),
    muteBus: vi.fn((bus: string, muted: boolean) => {
      s.muteBusCalls.push([bus, muted]);
    }),
    getBuses: vi.fn(() => ({
      master: { gain: { gain: { value: 1, rampTo: vi.fn() } }, muted: false },
      music: { gain: { gain: { value: 1, rampTo: vi.fn() } }, muted: false },
      sfx: { gain: { gain: { value: 1, rampTo: vi.fn() } }, muted: false },
      voice: { gain: { gain: { value: 1, rampTo: vi.fn() } }, muted: false },
      crowd: { gain: { gain: { value: 1, rampTo: vi.fn() } }, muted: false },
    })),
    buildBuses: vi.fn(),
    disposeBuses: vi.fn(),
  };
});

vi.mock('../src/sprite-resolver', () => {
  const s = busState;
  return {
    setResolverVolume: vi.fn((bus: string, vol: number) => {
      s.resolverVolumeCalls.push([bus, vol]);
    }),
    setResolverMute: vi.fn((bus: string, muted: boolean) => {
      s.resolverMuteCalls.push([bus, muted]);
    }),
    initSpriteResolver: vi.fn().mockResolvedValue(undefined),
  };
});

import {
  applyPersistedAudioPrefs,
  type AudioPrefsSnapshot,
  type AudioPrefsStore,
  registerFocusLossMute,
  setAndPersistBusMute,
  setAndPersistBusVolume,
  syncAudioPrefsFromSettings,
} from '../src';

const BUS_NAMES = ['master', 'music', 'sfx', 'voice', 'crowd'] as const;

function makePrefs(
  audioVolumes: Record<string, number> = {
    master: 80,
    music: 70,
    sfx: 85,
    voice: 80,
    crowd: 60,
  },
  overrides: { muteOnFocusLoss?: boolean; muteAll?: boolean } = {},
): AudioPrefsSnapshot {
  return {
    audioVolumes,
    muteOnFocusLoss: overrides.muteOnFocusLoss ?? false,
    muteAll: overrides.muteAll ?? false,
  };
}

function makeStore(initial: AudioPrefsSnapshot): AudioPrefsStore & {
  get: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
} {
  let current = initial;
  return {
    get: vi.fn(async () => current),
    update: vi.fn(async (patch: { audioVolumes: Record<string, number> }) => {
      current = { ...current, audioVolumes: patch.audioVolumes };
    }),
  };
}

function resetState() {
  busState.setBusVolumeCalls.length = 0;
  busState.muteBusCalls.length = 0;
  busState.resolverVolumeCalls.length = 0;
  busState.resolverMuteCalls.length = 0;
  vi.clearAllMocks();
  registerFocusLossMute(false);
}

beforeEach(resetState);
afterEach(resetState);

describe('applyPersistedAudioPrefs', () => {
  it('applies stored volumes to all buses (linear conversion)', async () => {
    const store = makeStore(makePrefs({ master: 80, music: 70, sfx: 85, voice: 80, crowd: 60 }));
    await applyPersistedAudioPrefs(store, BUS_NAMES);

    const { setBusVolume } = await import('../src/buses');
    expect(vi.mocked(setBusVolume)).toHaveBeenCalledWith('master', 0.8, 0);
    expect(vi.mocked(setBusVolume)).toHaveBeenCalledWith('music', 0.7, 0);
    expect(vi.mocked(setBusVolume)).toHaveBeenCalledWith('sfx', 0.85, 0);
    expect(vi.mocked(setBusVolume)).toHaveBeenCalledWith('voice', 0.8, 0);
    expect(vi.mocked(setBusVolume)).toHaveBeenCalledWith('crowd', 0.6, 0);
  });

  it('also applies volumes to sprite resolver', async () => {
    const store = makeStore(makePrefs({ master: 100, sfx: 50 }));
    await applyPersistedAudioPrefs(store, BUS_NAMES);

    const { setResolverVolume } = await import('../src/sprite-resolver');
    expect(vi.mocked(setResolverVolume)).toHaveBeenCalledWith('master', 1);
    expect(vi.mocked(setResolverVolume)).toHaveBeenCalledWith('sfx', 0.5);
  });

  it('muteAll=true mutes all buses', async () => {
    const store = makeStore(makePrefs({}, { muteAll: true }));
    await applyPersistedAudioPrefs(store, BUS_NAMES);

    const { muteBus } = await import('../src/buses');
    const muteTrueCalls = vi.mocked(muteBus).mock.calls.filter(([, m]) => m === true);
    expect(muteTrueCalls.length).toBeGreaterThanOrEqual(BUS_NAMES.length);
  });

  it('missing bus volume falls back to the default (75/100 = 0.75)', async () => {
    const store = makeStore(makePrefs({}));
    await applyPersistedAudioPrefs(store, BUS_NAMES);

    const { setBusVolume } = await import('../src/buses');
    for (const bus of BUS_NAMES) {
      expect(vi.mocked(setBusVolume)).toHaveBeenCalledWith(bus, 0.75, 0);
    }
  });

  it('respects a caller-supplied default volume', async () => {
    const store = makeStore(makePrefs({}));
    await applyPersistedAudioPrefs(store, BUS_NAMES, 50);

    const { setBusVolume } = await import('../src/buses');
    expect(vi.mocked(setBusVolume)).toHaveBeenCalledWith('master', 0.5, 0);
  });

  it('registers focus-loss muting with every configured bus', async () => {
    const store = makeStore(makePrefs({}, { muteOnFocusLoss: true }));
    await applyPersistedAudioPrefs(store, BUS_NAMES);

    window.dispatchEvent(new Event('blur'));
    const { muteBus } = await import('../src/buses');
    for (const bus of BUS_NAMES) {
      expect(vi.mocked(muteBus)).toHaveBeenCalledWith(bus, true);
    }
  });
});

describe('setAndPersistBusVolume', () => {
  it('applies volume to live bus and resolver', async () => {
    const store = makeStore(makePrefs());
    await setAndPersistBusVolume('sfx', 90, store);

    const { setBusVolume } = await import('../src/buses');
    const { setResolverVolume } = await import('../src/sprite-resolver');
    expect(vi.mocked(setBusVolume)).toHaveBeenCalledWith('sfx', 0.9);
    expect(vi.mocked(setResolverVolume)).toHaveBeenCalledWith('sfx', 0.9);
  });

  it('persists the updated volume to the store', async () => {
    const store = makeStore(makePrefs({ master: 80, music: 70, sfx: 80, voice: 80, crowd: 60 }));
    await setAndPersistBusVolume('music', 55, store);
    expect(store.update).toHaveBeenCalledWith(
      expect.objectContaining({
        audioVolumes: expect.objectContaining({ music: 55 }),
      }),
    );
  });

  it('clamps volume to [0, 100] before applying', async () => {
    const store = makeStore(makePrefs());
    await setAndPersistBusVolume('crowd', 150, store);

    const { setBusVolume } = await import('../src/buses');
    expect(vi.mocked(setBusVolume)).toHaveBeenCalledWith('crowd', 1);
  });
});

describe('setAndPersistBusMute', () => {
  it('mutes a bus on both Tone and resolver', async () => {
    setAndPersistBusMute('voice', true);

    const { muteBus } = await import('../src/buses');
    const { setResolverMute } = await import('../src/sprite-resolver');
    expect(vi.mocked(muteBus)).toHaveBeenCalledWith('voice', true);
    expect(vi.mocked(setResolverMute)).toHaveBeenCalledWith('voice', true);
  });

  it('unmutes a bus', async () => {
    setAndPersistBusMute('sfx', false);

    const { muteBus } = await import('../src/buses');
    expect(vi.mocked(muteBus)).toHaveBeenCalledWith('sfx', false);
  });
});

describe('syncAudioPrefsFromSettings', () => {
  it('merges and applies all bus volumes', async () => {
    const store = makeStore(makePrefs({ master: 80, music: 70, sfx: 80, voice: 80, crowd: 60 }));
    await syncAudioPrefsFromSettings({ master: 60, crowd: 40 }, BUS_NAMES, store);

    const { setBusVolume } = await import('../src/buses');
    expect(vi.mocked(setBusVolume)).toHaveBeenCalledWith('master', 0.6);
    expect(vi.mocked(setBusVolume)).toHaveBeenCalledWith('crowd', 0.4);
    expect(vi.mocked(setBusVolume)).toHaveBeenCalledWith('music', 0.7);
  });

  it('persists merged audioVolumes', async () => {
    const store = makeStore(makePrefs({ master: 80, music: 70, sfx: 80, voice: 80, crowd: 60 }));
    await syncAudioPrefsFromSettings({ sfx: 50 }, BUS_NAMES, store);
    expect(store.update).toHaveBeenCalledWith(
      expect.objectContaining({
        audioVolumes: expect.objectContaining({ sfx: 50, music: 70 }),
      }),
    );
  });
});

describe('registerFocusLossMute', () => {
  it('mutes all buses on window blur and restores on focus if still enabled', async () => {
    const store = makeStore(makePrefs({}, { muteOnFocusLoss: true }));
    registerFocusLossMute(true, store, BUS_NAMES);

    window.dispatchEvent(new Event('blur'));
    const { muteBus } = await import('../src/buses');
    let muteTrueCalls = vi.mocked(muteBus).mock.calls.filter(([, m]) => m === true);
    expect(muteTrueCalls.length).toBeGreaterThanOrEqual(BUS_NAMES.length);

    vi.mocked(muteBus).mockClear();
    window.dispatchEvent(new Event('focus'));
    await new Promise((r) => setTimeout(r, 10));
    const muteFalseCalls = vi.mocked(muteBus).mock.calls.filter(([, m]) => m === false);
    expect(muteFalseCalls.length).toBeGreaterThanOrEqual(BUS_NAMES.length);
  });

  it('disabling removes the listeners', async () => {
    const store = makeStore(makePrefs({}, { muteOnFocusLoss: true }));
    registerFocusLossMute(true, store, BUS_NAMES);
    registerFocusLossMute(false);

    const { muteBus } = await import('../src/buses');
    vi.mocked(muteBus).mockClear();
    window.dispatchEvent(new Event('blur'));
    expect(muteBus).not.toHaveBeenCalled();
  });
});
