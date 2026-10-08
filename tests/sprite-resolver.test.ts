/**
 * Tests: src/sprite-resolver.ts
 *
 * Mocks Howler with class-based mock (Vitest hoisting-safe).
 * Mocks fetch to provide sprite-map.json fixtures.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const howlerState = vi.hoisted(() => ({
  playArgs: [] as string[],
  stopArgs: [] as number[],
  volumeArgs: [] as Array<[number, number]>,
  pauseArgs: [] as number[],
  positionArgs: [] as Array<[number, number, number, number]>,
  listenerPositionArgs: [] as Array<[number, number, number]>,
  listenerOrientationArgs: [] as Array<[number, number, number, number, number, number]>,
  options: [] as Array<{
    sprite: Record<string, [number, number] | [number, number, boolean]>;
    src: string[];
  }>,
  unloadCalled: false,
  instances: [] as Array<{
    play: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    volume: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    pos: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    unload: ReturnType<typeof vi.fn>;
  }>,
  nextSoundId: 1,
}));

vi.mock('howler', () => {
  const s = howlerState;

  class MockHowl {
    play: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    volume: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    pos: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    unload: ReturnType<typeof vi.fn>;

    constructor(opts: {
      sprite: Record<string, [number, number] | [number, number, boolean]>;
      src: string[];
      preload: boolean;
      html5: boolean;
    }) {
      const play = vi.fn((cue: string) => {
        s.playArgs.push(cue);
        return s.nextSoundId++;
      });
      const stop = vi.fn((id: number) => {
        s.stopArgs.push(id);
      });
      const volume = vi.fn((vol: number, id: number) => {
        s.volumeArgs.push([vol, id]);
      });
      const pause = vi.fn((id: number) => {
        s.pauseArgs.push(id);
      });
      const pos = vi.fn((x: number, y: number, z: number, id: number) => {
        s.positionArgs.push([x, y, z, id]);
      });
      const unload = vi.fn(() => {
        s.unloadCalled = true;
      });
      const once = vi.fn();
      const on = vi.fn();
      const off = vi.fn();
      this.play = play;
      this.stop = stop;
      this.volume = volume;
      this.pause = pause;
      this.pos = pos;
      this.once = once;
      this.on = on;
      this.off = off;
      this.unload = unload;
      s.options.push({ sprite: opts.sprite, src: opts.src });
      s.instances.push({ play, stop, volume, pause, pos, on, once, off, unload });
    }
  }

  return {
    Howl: MockHowl,
    Howler: {
      pos: vi.fn((x: number, y: number, z: number) => s.listenerPositionArgs.push([x, y, z])),
      orientation: vi.fn((x: number, y: number, z: number, ux: number, uy: number, uz: number) =>
        s.listenerOrientationArgs.push([x, y, z, ux, uy, uz]),
      ),
    },
  };
});

const FLAT_SPRITE_MAP = {
  'drawer-open': { start_ms: 0, end_ms: 450, file: 'ui/sprite' },
  'ka-chunk': { start_ms: 500, end_ms: 700, file: 'ui/sprite' },
  'ring-bell': { start_ms: 0, end_ms: 1200, file: 'bell-and-bills/sprite' },
};

const NESTED_SPRITE_MAP = {
  'ui/sprite': {
    'drawer-open': { start_ms: 0, end_ms: 450, file: 'ui/sprite' },
    'ka-chunk': { start_ms: 500, end_ms: 700, file: 'ui/sprite' },
  },
  'bell-and-bills/sprite': {
    'ring-bell': { start_ms: 0, end_ms: 1200, file: 'bell-and-bills/sprite' },
  },
};

function mockFetchWith(body: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 404,
      json: () => Promise.resolve(body),
    }),
  );
}

function mockFetchFail(): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
}

function mockFetchMissing(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.reject(new Error('not found')),
    }),
  );
}

function resetHowlerState() {
  howlerState.playArgs.length = 0;
  howlerState.stopArgs.length = 0;
  howlerState.volumeArgs.length = 0;
  howlerState.pauseArgs.length = 0;
  howlerState.positionArgs.length = 0;
  howlerState.listenerPositionArgs.length = 0;
  howlerState.listenerOrientationArgs.length = 0;
  howlerState.options.length = 0;
  howlerState.unloadCalled = false;
  howlerState.instances.length = 0;
  howlerState.nextSoundId = 1;
}

import {
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
} from '../src';

describe('initSpriteResolver', () => {
  beforeEach(() => {
    resetHowlerState();
    disposeSpriteResolver();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    disposeSpriteResolver();
  });

  it('loads flat sprite-map.json and populates cue map', async () => {
    mockFetchWith(FLAT_SPRITE_MAP);
    await initSpriteResolver();
    const cues = _getCueMap();
    expect(cues['drawer-open']).toBeDefined();
    expect(cues['ka-chunk']).toBeDefined();
    expect(cues['ring-bell']).toBeDefined();
  });

  it('loads nested sprite-map.json and flattens cue map', async () => {
    mockFetchWith(NESTED_SPRITE_MAP);
    await initSpriteResolver();
    const cues = _getCueMap();
    expect(cues['drawer-open']).toBeDefined();
    expect(cues['ring-bell']).toBeDefined();
  });

  it('preserves prototype-named cues as ordinary own properties', async () => {
    const map = JSON.parse(
      '{"constructor":{"start_ms":0,"end_ms":100,"file":"ui/sprite"},"__proto__":{"start_ms":100,"end_ms":200,"file":"ui/sprite"}}',
    ) as unknown;
    mockFetchWith(map);
    await initSpriteResolver({ strict: true });
    const cues = _getCueMap();
    expect(Object.hasOwn(cues, 'constructor')).toBe(true);
    expect(Object.hasOwn(cues, '__proto__')).toBe(true);
  });

  it('rejects duplicate cue names across grouped maps in strict mode', async () => {
    mockFetchWith({
      first: { duplicate: { start_ms: 0, end_ms: 100, file: 'ui/first' } },
      second: { duplicate: { start_ms: 0, end_ms: 100, file: 'ui/second' } },
    });
    await expect(initSpriteResolver({ strict: true })).rejects.toThrow(/duplicate cue/);
  });

  it('is idempotent — calling twice does not rebuild Howls', async () => {
    mockFetchWith(FLAT_SPRITE_MAP);
    await initSpriteResolver();
    const instancesAfterFirst = howlerState.instances.length;
    await initSpriteResolver();
    expect(howlerState.instances.length).toBe(instancesAfterFirst);
  });

  it('shares one in-flight fetch across concurrent initialization calls', async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn(() => fetchPromise);
    vi.stubGlobal('fetch', fetchMock);

    const first = initSpriteResolver();
    const second = initSpriteResolver();
    resolveFetch?.({ ok: true, status: 200, json: () => Promise.resolve(FLAT_SPRITE_MAP) });
    await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(howlerState.instances).toHaveLength(2);
  });

  it('does not resurrect resolver state when disposed during initialization', async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    const initializing = initSpriteResolver();
    disposeSpriteResolver();
    resolveFetch?.({ ok: true, status: 200, json: () => Promise.resolve(FLAT_SPRITE_MAP) });
    await initializing;
    expect(_getCueMap()).toEqual({});
    expect(howlerState.unloadCalled).toBe(true);
  });

  it('rejects different options after initialization instead of silently ignoring them', async () => {
    mockFetchWith(FLAT_SPRITE_MAP);
    await initSpriteResolver();
    await expect(initSpriteResolver({ audioBaseUrl: '/other' })).rejects.toThrow(/dispose/);
  });

  it('strict mode rejects malformed maps and remains retryable', async () => {
    mockFetchWith({ broken: { start_ms: 10, end_ms: 5, file: '' } });
    await expect(initSpriteResolver({ strict: true })).rejects.toThrow(/Invalid sprite map/);
    mockFetchWith(FLAT_SPRITE_MAP);
    await expect(initSpriteResolver({ strict: true })).resolves.toBeUndefined();
  });

  it('rejects sprite files that escape the configured audio base', async () => {
    mockFetchWith({ escape: { start_ms: 0, end_ms: 100, file: '../private/sprite' } });
    await expect(initSpriteResolver({ strict: true })).rejects.toThrow(/Invalid sprite map/);

    mockFetchWith({ escape: { start_ms: 0, end_ms: 100, file: 'ui\\sprite' } });
    await expect(initSpriteResolver({ strict: true })).rejects.toThrow(/Invalid sprite map/);
  });

  it('validates resolver options before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(initSpriteResolver({ formats: [] })).rejects.toThrow(/formats/);
    await expect(initSpriteResolver({ formats: ['ogg', 'ogg'] })).rejects.toThrow(/duplicate/);
    await expect(initSpriteResolver({ spriteMapUrl: '' })).rejects.toThrow(/spriteMapUrl/);
    await expect(initSpriteResolver({ audioBaseUrl: '' })).rejects.toThrow(/audioBaseUrl/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gracefully handles missing sprite-map.json (resolves, no cues)', async () => {
    mockFetchMissing();
    await expect(initSpriteResolver()).resolves.toBeUndefined();
    expect(Object.keys(_getCueMap())).toHaveLength(0);
  });

  it('gracefully handles fetch error (resolves, no cues)', async () => {
    mockFetchFail();
    await expect(initSpriteResolver()).resolves.toBeUndefined();
  });

  it('respects a custom spriteMapUrl/formats/audioBaseUrl option set', async () => {
    mockFetchWith(FLAT_SPRITE_MAP);
    await initSpriteResolver({
      spriteMapUrl: '/custom/map.json',
      formats: ['ogg'],
      audioBaseUrl: '/custom-audio',
    });
    const opts = _getLastResolverOptions();
    expect(opts.spriteMapUrl).toBe('/custom/map.json');
    expect(opts.formats).toEqual(['ogg']);
    expect(opts.audioBaseUrl).toBe('/custom-audio');
  });

  it('uses a file-local wav/ogg format list and emits a looping sprite tuple', async () => {
    mockFetchWith({
      ambience: {
        start_ms: 0,
        end_ms: 2_000,
        file: 'music/ambience',
        formats: ['wav', 'ogg'],
        loop: true,
      },
    });
    await initSpriteResolver({ strict: true });

    expect(howlerState.options[0]).toEqual({
      src: ['/audio/music/ambience.wav', '/audio/music/ambience.ogg'],
      sprite: { ambience: [0, 2_000, true] },
    });
  });

  it('rejects conflicting format declarations for one sprite file in strict mode', async () => {
    mockFetchWith({
      first: { start_ms: 0, end_ms: 100, file: 'music/ambience', formats: ['wav', 'ogg'] },
      second: { start_ms: 100, end_ms: 200, file: 'music/ambience', formats: ['ogg', 'wav'] },
    });
    await expect(initSpriteResolver({ strict: true })).rejects.toThrow(/formats for/);
  });

  it('defaults to /audio/sprite-map.json + webm/m4a when no options given', async () => {
    mockFetchWith(FLAT_SPRITE_MAP);
    await initSpriteResolver();
    const opts = _getLastResolverOptions();
    expect(opts.spriteMapUrl).toBe('/audio/sprite-map.json');
    expect(opts.formats).toEqual(['webm', 'm4a']);
    expect(opts.audioBaseUrl).toBe('/audio');
  });

  it('treats a primitive sprite-map response as empty', async () => {
    mockFetchWith('not-an-object');
    await initSpriteResolver();
    expect(Object.keys(_getCueMap())).toHaveLength(0);
  });

  it('treats a null sprite-map response as empty', async () => {
    mockFetchWith(null);
    await initSpriteResolver();
    expect(Object.keys(_getCueMap())).toHaveLength(0);
  });

  it('skips non-object values when flattening a nested sprite map', async () => {
    mockFetchWith({
      'ui/sprite': { 'drawer-open': { start_ms: 0, end_ms: 450, file: 'ui/sprite' } },
      // A stray primitive value alongside real sprite-file entries must be
      // skipped rather than throwing while flattening.
      'not-a-sprite-file': 'unexpected string value',
    });
    await initSpriteResolver();
    const cues = _getCueMap();
    expect(cues['drawer-open']).toBeDefined();
    expect(Object.keys(cues)).toHaveLength(1);
  });
});

describe('playCue', () => {
  beforeEach(async () => {
    resetHowlerState();
    disposeSpriteResolver();
    mockFetchWith(FLAT_SPRITE_MAP);
    await initSpriteResolver();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    disposeSpriteResolver();
  });

  it('returns a positive sound id for known cue', () => {
    const id = playCue('drawer-open', 'sfx');
    expect(id).toBeGreaterThan(0);
  });

  it('applies full volume by default when no master bus has been designated', () => {
    playCue('drawer-open', 'sfx');
    const volCall = howlerState.volumeArgs.at(-1);
    expect(volCall?.[0]).toBe(1);
  });

  it('returns -1 for unknown cue', () => {
    expect(playCue('nonexistent-cue', 'sfx')).toBe(-1);
  });

  it('warns and returns -1 when called before initSpriteResolver()', () => {
    disposeSpriteResolver();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(playCue('drawer-open', 'sfx')).toBe(-1);
    expect(warning).toHaveBeenCalledWith(
      '[gesture-audio/sprite-resolver] resolver not initialised; call initSpriteResolver() first',
    );
    warning.mockRestore();
  });

  it('calls Howl.play with the cue name', () => {
    playCue('drawer-open', 'sfx');
    expect(howlerState.playArgs).toContain('drawer-open');
  });

  it('applies volume to the sound', () => {
    playCue('ka-chunk', 'sfx');
    expect(howlerState.volumeArgs.length).toBeGreaterThan(0);
  });

  it('plays cue from different sprite sheet (ring-bell)', () => {
    const id = playCue('ring-bell', 'sfx');
    expect(id).toBeGreaterThan(0);
    expect(howlerState.playArgs).toContain('ring-bell');
  });

  it('defaults busTarget to "sfx" when omitted', () => {
    const id = playCue('drawer-open');
    expect(id).toBeGreaterThan(0);
  });
});

describe('stopCue', () => {
  beforeEach(async () => {
    resetHowlerState();
    disposeSpriteResolver();
    mockFetchWith(FLAT_SPRITE_MAP);
    await initSpriteResolver();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    disposeSpriteResolver();
  });

  it('no-ops for id=-1', () => {
    expect(() => stopCue(-1)).not.toThrow();
    expect(howlerState.stopArgs).toHaveLength(0);
  });

  it('calls stop on the Howl that played the sound', () => {
    const id = playCue('ring-bell', 'sfx');
    stopCue(id);
    expect(howlerState.stopArgs).toContain(id);
  });
});

describe('cue transport, mix and spatial controls', () => {
  beforeEach(async () => {
    resetHowlerState();
    disposeSpriteResolver();
    mockFetchWith({
      loop: {
        start_ms: 0,
        end_ms: 1_000,
        file: 'music/loop',
        loop: true,
        formats: ['wav', 'ogg'],
      },
    });
    await initSpriteResolver();
    setResolverMasterBus('master');
    setResolverVolume('master', 1);
    setResolverVolume('music', 1);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    disposeSpriteResolver();
  });

  it('keeps a looping ID live after an end callback so live mix and stop still reach it', () => {
    const id = playCue('loop', { bus: 'music', gain: 0.5 });
    const instance = howlerState.instances[0];
    const endHandler = instance?.on.mock.calls.find(([event]) => event === 'end')?.[1] as
      | (() => void)
      | undefined;
    endHandler?.();

    setResolverVolume('music', 0.4);
    expect(howlerState.volumeArgs.at(-1)).toEqual([0.2, id]);
    stopCue(id);
    expect(howlerState.stopArgs).toContain(id);
  });

  it('pauses and resumes the same Howler ID', () => {
    const id = playCue('loop', 'music');
    expect(pauseCue(id)).toBe(true);
    expect(howlerState.pauseArgs).toContain(id);
    expect(resumeCue(id)).toBe(id);
    expect(howlerState.playArgs).toContain(id);
  });

  it('composes cue gain with master, bus, mute and live volume changes', () => {
    setResolverVolume('master', 0.5);
    setResolverVolume('music', 0.4);
    const id = playCue('loop', { bus: 'music', gain: 0.5 });
    expect(howlerState.volumeArgs.at(-1)).toEqual([0.1, id]);
    expect(setCueGain(id, 0.25)).toBe(true);
    expect(howlerState.volumeArgs.at(-1)).toEqual([0.05, id]);
    setResolverMute('music', true);
    expect(howlerState.volumeArgs.at(-1)).toEqual([0, id]);
    setResolverMute('music', false);
    setResolverVolume('music', 0.8);
    expect(howlerState.volumeArgs.at(-1)).toEqual([0.1, id]);
  });

  it('fades logical cue gain through mute and pauses the fade clock while paused', () => {
    vi.useFakeTimers();
    const id = playCue('loop', 'music');
    expect(fadeCue(id, 0, 100)).toBe(true);
    vi.advanceTimersByTime(50);
    expect(howlerState.volumeArgs.at(-1)?.[0]).toBeCloseTo(0.5, 1);
    expect(howlerState.volumeArgs.at(-1)?.[1]).toBe(id);
    expect(pauseCue(id)).toBe(true);
    setResolverMute('music', true);
    vi.advanceTimersByTime(500);
    expect(howlerState.volumeArgs.at(-1)).toEqual([0, id]);
    setResolverMute('music', false);
    expect(resumeCue(id)).toBe(id);
    vi.advanceTimersByTime(60);
    expect(howlerState.volumeArgs.at(-1)).toEqual([0, id]);
  });

  it('applies an immediate logical fade target', () => {
    const id = playCue('loop', 'music');
    expect(fadeCue(id, 0.3, 0)).toBe(true);
    expect(howlerState.volumeArgs.at(-1)).toEqual([0.3, id]);
  });

  it('uses public Howler spatial APIs and rejects malformed coordinate data', () => {
    const id = playCue('loop', { bus: 'music', position: [1, 2, 3] });
    expect(howlerState.positionArgs).toContainEqual([1, 2, 3, id]);
    expect(setCuePosition(id, [4, 5, 6])).toBe(true);
    setAudioListener([7, 8, 9], [0, 0, -1]);
    expect(howlerState.listenerPositionArgs).toContainEqual([7, 8, 9]);
    expect(howlerState.listenerOrientationArgs).toContainEqual([0, 0, -1, 0, 1, 0]);
    expect(() => playCue('loop', { position: [Number.NaN, 0, 0] })).toThrow(/finite/);
    expect(() => setCuePosition(id, [0, 1] as unknown as [number, number, number])).toThrow(
      /three-number/,
    );
  });
});

describe('bus volume and mute', () => {
  beforeEach(async () => {
    resetHowlerState();
    disposeSpriteResolver();
    mockFetchWith(FLAT_SPRITE_MAP);
    await initSpriteResolver();
    setResolverMasterBus('master');
    setResolverMute('master', false);
    setResolverMute('sfx', false);
    setResolverVolume('master', 1);
    setResolverVolume('sfx', 1);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    disposeSpriteResolver();
  });

  it('setResolverVolume clamps values outside [0,1]', () => {
    expect(() => setResolverVolume('sfx', 1.5)).not.toThrow();
    expect(() => setResolverVolume('sfx', -0.5)).not.toThrow();
  });

  it('updates the volume of sounds that are already playing', () => {
    const id = playCue('drawer-open', 'sfx');
    setResolverVolume('sfx', 0.25);
    expect(howlerState.volumeArgs.at(-1)).toEqual([0.25, id]);
    setResolverMute('sfx', true);
    expect(howlerState.volumeArgs.at(-1)).toEqual([0, id]);
  });

  it('removes active-sound tracking and sibling listeners when playback ends', () => {
    const id = playCue('drawer-open', 'sfx');
    const instance = howlerState.instances[0];
    const endRegistration = instance?.on.mock.calls.find(([event]) => event === 'end');
    const cleanup = endRegistration?.[1] as (() => void) | undefined;
    expect(cleanup).toBeTypeOf('function');
    cleanup?.();
    const volumeCallsAfterCleanup = howlerState.volumeArgs.length;
    setResolverVolume('sfx', 0.4);
    expect(howlerState.volumeArgs).toHaveLength(volumeCallsAfterCleanup);
    expect(instance?.off).toHaveBeenCalledWith('end', endRegistration?.[1], id);
    expect(instance?.off).toHaveBeenCalledWith('stop', expect.any(Function), id);
    expect(instance?.off).toHaveBeenCalledWith('playerror', expect.any(Function), id);
  });

  it('rejects non-finite volume values', () => {
    expect(() => setResolverVolume('sfx', Number.NaN)).toThrow(/finite/);
  });

  it('muted sfx bus causes zero volume on play', () => {
    setResolverMute('sfx', true);
    playCue('drawer-open', 'sfx');
    const volCall = howlerState.volumeArgs[0];
    expect(volCall?.[0]).toBe(0);
    setResolverMute('sfx', false);
  });

  it('master mute causes zero volume on play', () => {
    setResolverMute('master', true);
    playCue('drawer-open', 'sfx');
    const volCall = howlerState.volumeArgs[0];
    expect(volCall?.[0]).toBe(0);
    setResolverMute('master', false);
  });

  it('full volume bus plays at positive volume', () => {
    setResolverVolume('sfx', 1);
    setResolverVolume('master', 1);
    playCue('drawer-open', 'sfx');
    const volCall = howlerState.volumeArgs[0];
    expect(volCall?.[0]).toBeGreaterThan(0);
  });

  it('without a designated master bus, only the target bus mute/volume applies', () => {
    setResolverMasterBus(null);
    setResolverMute('master', true); // should have no special effect anymore
    setResolverVolume('sfx', 1);
    playCue('drawer-open', 'sfx');
    const volCall = howlerState.volumeArgs.at(-1);
    expect(volCall?.[0]).toBeGreaterThan(0);
    setResolverMute('master', false);
  });

  it('defaults the master bus to full volume when a master bus is designated but no volume was ever set for it', () => {
    setResolverMasterBus('unconfigured-master');
    setResolverVolume('sfx', 1);
    playCue('drawer-open', 'sfx');
    const volCall = howlerState.volumeArgs.at(-1);
    expect(volCall?.[0]).toBe(1);
  });
});
