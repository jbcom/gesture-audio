/** Tests: `gesture-audio/tone-lazy` defers Tone evaluation until lifecycle start. */

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('tone');
  vi.doUnmock('../src/tone-runtime');
  vi.resetModules();
});

describe('gesture-audio/tone-lazy', () => {
  it('imports without evaluating Tone', async () => {
    vi.resetModules();
    vi.doMock('tone', () => {
      throw new Error('tone must not evaluate while importing the lazy entry');
    });

    const entry = await import('../src/tone-lazy');

    expect(Object.keys(entry).sort()).toEqual(
      [
        '_resetToneLazyEngine',
        'isToneLazyEngineStarted',
        'registerToneLazyGestureTrigger',
        'startToneLazyEngine',
      ].sort(),
    );
    expect(entry.isToneLazyEngineStarted()).toBe(false);
  });

  it('loads Tone and supplies its runtime only after start', async () => {
    const startTone = vi.fn().mockResolvedValue(undefined);
    const runtime = {
      buildBuses: vi.fn(),
      disposeBuses: vi.fn(),
      duckBus: vi.fn(),
      getBuses: vi.fn(),
      muteBus: vi.fn(),
      setBusVolume: vi.fn(),
    };
    vi.doMock('../src/tone-runtime', () => ({ startTone, toneRuntime: runtime }));
    const entry = await import('../src/tone-lazy');
    const bootstrap = vi.fn().mockResolvedValue(undefined);

    await entry.startToneLazyEngine(bootstrap);

    expect(startTone).toHaveBeenCalledOnce();
    expect(bootstrap).toHaveBeenCalledWith(runtime);
    expect(entry.isToneLazyEngineStarted()).toBe(true);
  });

  it('keeps a failed runtime start retryable', async () => {
    const startTone = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('locked'))
      .mockResolvedValueOnce(undefined);
    const runtime = {
      buildBuses: vi.fn(),
      disposeBuses: vi.fn(),
      duckBus: vi.fn(),
      getBuses: vi.fn(),
      muteBus: vi.fn(),
      setBusVolume: vi.fn(),
    };
    vi.doMock('../src/tone-runtime', () => ({ startTone, toneRuntime: runtime }));
    const entry = await import('../src/tone-lazy');
    const bootstrap = vi.fn().mockResolvedValue(undefined);

    await expect(entry.startToneLazyEngine(bootstrap)).rejects.toThrow('locked');
    await expect(entry.startToneLazyEngine(bootstrap)).resolves.toBeUndefined();

    expect(startTone).toHaveBeenCalledTimes(2);
    expect(bootstrap).toHaveBeenCalledOnce();
    expect(entry.isToneLazyEngineStarted()).toBe(true);
  });

  it('keeps a bootstrap rejection retryable', async () => {
    const startTone = vi.fn().mockResolvedValue(undefined);
    const runtime = {
      buildBuses: vi.fn(),
      disposeBuses: vi.fn(),
      duckBus: vi.fn(),
      getBuses: vi.fn(),
      muteBus: vi.fn(),
      setBusVolume: vi.fn(),
    };
    const bootstrap = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('bootstrap failed'))
      .mockResolvedValueOnce(undefined);
    vi.doMock('../src/tone-runtime', () => ({ startTone, toneRuntime: runtime }));
    const entry = await import('../src/tone-lazy');

    await expect(entry.startToneLazyEngine(bootstrap)).rejects.toThrow('bootstrap failed');
    await expect(entry.startToneLazyEngine(bootstrap)).resolves.toBeUndefined();

    expect(startTone).toHaveBeenCalledTimes(2);
    expect(bootstrap).toHaveBeenCalledTimes(2);
    expect(entry.isToneLazyEngineStarted()).toBe(true);
  });

  it('shares a concurrent start attempt', async () => {
    let resolveUnlock!: () => void;
    const unlockPending = new Promise<void>((resolveUnlockPending) => {
      resolveUnlock = resolveUnlockPending;
    });
    const startTone = vi.fn().mockReturnValue(unlockPending);
    const runtime = {
      buildBuses: vi.fn(),
      disposeBuses: vi.fn(),
      duckBus: vi.fn(),
      getBuses: vi.fn(),
      muteBus: vi.fn(),
      setBusVolume: vi.fn(),
    };
    vi.doMock('../src/tone-runtime', () => ({ startTone, toneRuntime: runtime }));
    const entry = await import('../src/tone-lazy');
    const bootstrap = vi.fn().mockResolvedValue(undefined);

    const first = entry.startToneLazyEngine(bootstrap);
    const second = entry.startToneLazyEngine(bootstrap);
    await vi.waitFor(() => expect(startTone).toHaveBeenCalledOnce());
    expect(bootstrap).not.toHaveBeenCalled();
    resolveUnlock();
    await Promise.all([first, second]);

    expect(bootstrap).toHaveBeenCalledOnce();
    expect(entry.isToneLazyEngineStarted()).toBe(true);
  });

  it('does not let a pre-reset start completion mark the replacement generation started', async () => {
    let resolveBootstrap!: () => void;
    const bootstrapPending = new Promise<void>((resolveBootstrapPending) => {
      resolveBootstrap = resolveBootstrapPending;
    });
    const startTone = vi.fn().mockResolvedValue(undefined);
    const runtime = {
      buildBuses: vi.fn(),
      disposeBuses: vi.fn(),
      duckBus: vi.fn(),
      getBuses: vi.fn(),
      muteBus: vi.fn(),
      setBusVolume: vi.fn(),
    };
    vi.doMock('../src/tone-runtime', () => ({ startTone, toneRuntime: runtime }));
    const entry = await import('../src/tone-lazy');
    const bootstrap = vi.fn().mockReturnValue(bootstrapPending);

    const pending = entry.startToneLazyEngine(bootstrap);
    await vi.waitFor(() => expect(bootstrap).toHaveBeenCalledOnce());
    entry._resetToneLazyEngine();
    resolveBootstrap();
    await pending;

    expect(entry.isToneLazyEngineStarted()).toBe(false);
  });

  it('starts from a registered real-gesture listener and resets for hot reload', async () => {
    const startTone = vi.fn().mockResolvedValue(undefined);
    const runtime = {
      buildBuses: vi.fn(),
      disposeBuses: vi.fn(),
      duckBus: vi.fn(),
      getBuses: vi.fn(),
      muteBus: vi.fn(),
      setBusVolume: vi.fn(),
    };
    vi.doMock('../src/tone-runtime', () => ({ startTone, toneRuntime: runtime }));
    const entry = await import('../src/tone-lazy');
    const bootstrap = vi.fn().mockResolvedValue(undefined);
    const remove = entry.registerToneLazyGestureTrigger(bootstrap);

    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(bootstrap).toHaveBeenCalledWith(runtime));
    expect(entry.isToneLazyEngineStarted()).toBe(true);

    entry._resetToneLazyEngine();
    remove();
    expect(entry.isToneLazyEngineStarted()).toBe(false);
  });
});

describe('Tone runtime', () => {
  it('starts Tone and exposes only the bus runtime after it has loaded', async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const buses = {
      buildBuses: vi.fn(),
      disposeBuses: vi.fn(),
      duckBus: vi.fn(),
      getBuses: vi.fn(),
      muteBus: vi.fn(),
      setBusVolume: vi.fn(),
    };
    vi.doMock('tone', () => ({ start }));
    vi.doMock('../src/buses', () => buses);

    const runtimeModule = await import('../src/tone-runtime');
    await runtimeModule.startTone();

    expect(start).toHaveBeenCalledOnce();
    expect(runtimeModule.toneRuntime).toEqual(buses);
  });
});
