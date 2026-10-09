/**
 * Tests: src/howler-unlock.ts (via the gesture-audio/howler entry)
 *
 * Howler is mocked with a controllable AudioContext. `tone` is mocked to throw
 * on load, so any import of Tone anywhere in this lifecycle's graph fails here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('tone', () => {
  throw new Error('tone must not be loaded by the Howler-only entry');
});

interface FakeContext {
  state: string;
  resume: ReturnType<typeof vi.fn>;
}

const howler = vi.hoisted(() => ({
  usingWebAudio: true,
  ctx: null as null | FakeContext,
  createContext: null as unknown as () => FakeContext,
  volumeCalls: 0,
}));

vi.mock('howler', () => ({
  Howl: class {},
  Howler: {
    get ctx() {
      return howler.ctx;
    },
    get usingWebAudio() {
      return howler.usingWebAudio;
    },
    // Howler's own getter runs its lazy context setup when none exists yet.
    volume: vi.fn(() => {
      howler.volumeCalls += 1;
      if (!howler.ctx) howler.ctx = howler.createContext();
      return 1;
    }),
  },
}));

import {
  _resetAudioEngine,
  isAudioEngineStarted,
  registerAudioGestureTrigger,
  startAudioEngine,
} from '../src/howler';

function newContext(state = 'suspended'): FakeContext {
  const ctx = {
    state,
    resume: vi.fn(async () => {
      ctx.state = 'running';
    }),
  };
  return ctx;
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

describe('Howler startAudioEngine', () => {
  beforeEach(() => {
    _resetAudioEngine();
    howler.usingWebAudio = true;
    howler.ctx = null;
    howler.volumeCalls = 0;
    howler.createContext = () => newContext();
  });
  afterEach(() => {
    _resetAudioEngine();
  });

  it('creates Howler’s context when it does not exist yet, resumes it, then bootstraps', async () => {
    const order: string[] = [];
    howler.createContext = () => {
      order.push('create');
      const ctx = newContext();
      ctx.resume.mockImplementation(async () => {
        order.push('resume');
        ctx.state = 'running';
      });
      return ctx;
    };
    const bootstrap = vi.fn(async () => {
      order.push('bootstrap');
    });
    await startAudioEngine(bootstrap);
    expect(order).toEqual(['create', 'resume', 'bootstrap']);
    expect(isAudioEngineStarted()).toBe(true);
  });

  it('reuses a context Howler already created without creating another', async () => {
    const existing = newContext();
    howler.ctx = existing;
    await startAudioEngine(vi.fn());
    expect(howler.volumeCalls).toBe(0);
    expect(existing.resume).toHaveBeenCalledTimes(1);
  });

  it('does not resume a context that is already running', async () => {
    const running = newContext('running');
    howler.ctx = running;
    const bootstrap = vi.fn();
    await startAudioEngine(bootstrap);
    expect(running.resume).not.toHaveBeenCalled();
    expect(bootstrap).toHaveBeenCalledOnce();
  });

  it('is idempotent: later calls neither resume nor bootstrap again', async () => {
    const ctx = newContext();
    howler.ctx = ctx;
    const bootstrap = vi.fn();
    await startAudioEngine(bootstrap);
    await startAudioEngine(bootstrap);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent callers onto one resume and one bootstrap', async () => {
    const ctx = newContext();
    let release: (() => void) | undefined;
    ctx.resume.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            ctx.state = 'running';
            resolve();
          };
        }),
    );
    howler.ctx = ctx;
    const bootstrap = vi.fn();
    const first = startAudioEngine(bootstrap);
    const second = startAudioEngine(bootstrap);
    const third = startAudioEngine(bootstrap);
    release?.();
    await Promise.all([first, second, third]);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it('stays retryable after a failed resume', async () => {
    const ctx = newContext();
    ctx.resume.mockRejectedValueOnce(new Error('locked'));
    howler.ctx = ctx;
    const bootstrap = vi.fn();
    await expect(startAudioEngine(bootstrap)).rejects.toThrow('locked');
    expect(isAudioEngineStarted()).toBe(false);
    expect(bootstrap).not.toHaveBeenCalled();
    await expect(startAudioEngine(bootstrap)).resolves.toBeUndefined();
    expect(isAudioEngineStarted()).toBe(true);
    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it('stays retryable after a failed bootstrap without resuming twice', async () => {
    const ctx = newContext();
    howler.ctx = ctx;
    const bootstrap = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    await expect(startAudioEngine(bootstrap)).rejects.toThrow('boom');
    expect(isAudioEngineStarted()).toBe(false);
    await expect(startAudioEngine(bootstrap)).resolves.toBeUndefined();
    expect(isAudioEngineStarted()).toBe(true);
    expect(bootstrap).toHaveBeenCalledTimes(2);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it('runs the bootstrap when Howler has no Web Audio context', async () => {
    howler.usingWebAudio = false;
    const bootstrap = vi.fn();
    await startAudioEngine(bootstrap);
    expect(howler.volumeCalls).toBe(0);
    expect(bootstrap).toHaveBeenCalledOnce();
    expect(isAudioEngineStarted()).toBe(true);
  });

  it('runs the bootstrap when Howler cannot create a context', async () => {
    howler.createContext = () => null as never;
    const bootstrap = vi.fn();
    await startAudioEngine(bootstrap);
    expect(bootstrap).toHaveBeenCalledOnce();
  });

  it('does not mark a superseded attempt as started after a reset', async () => {
    const ctx = newContext();
    let release: (() => void) | undefined;
    ctx.resume.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    howler.ctx = ctx;
    const attempt = startAudioEngine(vi.fn());
    _resetAudioEngine();
    release?.();
    await attempt;
    expect(isAudioEngineStarted()).toBe(false);
  });
});

describe('Howler registerAudioGestureTrigger', () => {
  beforeEach(() => {
    _resetAudioEngine();
    howler.usingWebAudio = true;
    howler.ctx = newContext();
  });
  afterEach(() => {
    _resetAudioEngine();
  });

  it.each([
    ['click', () => new MouseEvent('click', { bubbles: true })],
    ['keydown', () => new KeyboardEvent('keydown', { bubbles: true })],
    ['touchstart', () => new Event('touchstart', { bubbles: true })],
    ['pointerdown', () => new Event('pointerdown', { bubbles: true })],
  ])('unlocks and bootstraps on %s, then disarms', async (_name, makeEvent) => {
    const bootstrap = vi.fn();
    registerAudioGestureTrigger(bootstrap);
    expect(howler.ctx?.resume).not.toHaveBeenCalled();
    document.dispatchEvent(makeEvent());
    await settle();
    expect(howler.ctx?.resume).toHaveBeenCalledTimes(1);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(isAudioEngineStarted()).toBe(true);
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it('resumes once for a burst of different gestures', async () => {
    const bootstrap = vi.fn();
    registerAudioGestureTrigger(bootstrap);
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    await settle();
    expect(howler.ctx?.resume).toHaveBeenCalledTimes(1);
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it('keeps listeners armed after a failed unlock so a later gesture retries', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    howler.ctx?.resume.mockRejectedValueOnce(new Error('locked'));
    const bootstrap = vi.fn();
    registerAudioGestureTrigger(bootstrap);
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(bootstrap).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      '[gesture-audio/howler-unlock] Failed to start audio engine:',
      expect.any(Error),
    );
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await settle();
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(isAudioEngineStarted()).toBe(true);
    warning.mockRestore();
  });

  it('returns a cleanup that removes the listeners', async () => {
    const bootstrap = vi.fn();
    const cleanup = registerAudioGestureTrigger(bootstrap);
    cleanup();
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await settle();
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it('does not register duplicate handlers', async () => {
    const bootstrap = vi.fn();
    registerAudioGestureTrigger(bootstrap);
    registerAudioGestureTrigger(bootstrap);
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });
});
