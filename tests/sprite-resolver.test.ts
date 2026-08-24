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
  unloadCalled: false,
  instances: [] as Array<{
    play: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    volume: ReturnType<typeof vi.fn>;
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
    unload: ReturnType<typeof vi.fn>;

    constructor(_opts: {
      sprite: Record<string, [number, number]>;
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
      const unload = vi.fn(() => {
        s.unloadCalled = true;
      });
      this.play = play;
      this.stop = stop;
      this.volume = volume;
      this.unload = unload;
      s.instances.push({ play, stop, volume, unload });
    }
  }

  return { Howl: MockHowl };
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
  howlerState.unloadCalled = false;
  howlerState.instances.length = 0;
  howlerState.nextSoundId = 1;
}

import {
  _getCueMap,
  _getLastResolverOptions,
  disposeSpriteResolver,
  initSpriteResolver,
  playCue,
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

  it('is idempotent — calling twice does not rebuild Howls', async () => {
    mockFetchWith(FLAT_SPRITE_MAP);
    await initSpriteResolver();
    const instancesAfterFirst = howlerState.instances.length;
    await initSpriteResolver();
    expect(howlerState.instances.length).toBe(instancesAfterFirst);
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
