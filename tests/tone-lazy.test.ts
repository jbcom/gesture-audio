/** Tests: `gesture-audio/tone-lazy` defers Tone evaluation until lifecycle start. */

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('tone');
  vi.doUnmock('../src/tone-runtime');
  vi.resetModules();
});

function busRuntime() {
  return {
    buildBuses: vi.fn(),
    disposeBuses: vi.fn(),
    duckBus: vi.fn(),
    getBuses: vi.fn(),
    muteBus: vi.fn(),
    setBusVolume: vi.fn(),
  };
}

/** Stands in for the dynamically loaded runtime chunk; returns the bus runtime it hands out. */
function mockRuntime(
  startTone: () => Promise<void>,
  setToneSuspended: (suspended: boolean) => Promise<void> = vi.fn().mockResolvedValue(undefined),
) {
  const runtime = busRuntime();
  vi.doMock('../src/tone-runtime', () => ({ startTone, setToneSuspended, toneRuntime: runtime }));
  return runtime;
}

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
        'setToneLazySuspended',
        'startToneLazyEngine',
      ].sort(),
    );
    expect(entry.isToneLazyEngineStarted()).toBe(false);
  });

  it('suspends and resumes Tone only once a start has unlocked it', async () => {
    const startTone = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('locked'))
      .mockResolvedValueOnce(undefined);
    const setToneSuspended = vi.fn().mockResolvedValue(undefined);
    mockRuntime(startTone, setToneSuspended);
    const entry = await import('../src/tone-lazy');

    await entry.setToneLazySuspended(true);
    await expect(entry.startToneLazyEngine(vi.fn())).rejects.toThrow('locked');
    await entry.setToneLazySuspended(false);
    expect(setToneSuspended).not.toHaveBeenCalled();

    await entry.startToneLazyEngine(vi.fn().mockResolvedValue(undefined));
    await entry.setToneLazySuspended(true);
    await entry.setToneLazySuspended(false);
    expect(setToneSuspended.mock.calls).toEqual([[true], [false]]);

    entry._resetToneLazyEngine();
    await entry.setToneLazySuspended(true);
    expect(setToneSuspended).toHaveBeenCalledTimes(2);
  });

  it('loads Tone and supplies its runtime only after start', async () => {
    const startTone = vi.fn().mockResolvedValue(undefined);
    const runtime = mockRuntime(startTone);
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
    mockRuntime(startTone);
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
    const bootstrap = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('bootstrap failed'))
      .mockResolvedValueOnce(undefined);
    mockRuntime(startTone);
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
    mockRuntime(startTone);
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
    mockRuntime(startTone);
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
    const runtime = mockRuntime(startTone);
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
    const buses = busRuntime();
    vi.doMock('tone', () => ({ start }));
    vi.doMock('../src/buses', () => buses);

    const runtimeModule = await import('../src/tone-runtime');
    await runtimeModule.startTone();

    expect(start).toHaveBeenCalledOnce();
    expect(runtimeModule.toneRuntime).toEqual(buses);
  });

  /** A context whose state moves when its transition settles: a tick later when `slow`, as a browser's does. */
  function fakeContext(state: AudioContextState, fails = false, slow = false) {
    const settle = () => (slow ? new Promise((resolve) => setTimeout(resolve, 0)) : undefined);
    const context = {
      state,
      suspend: vi.fn(async () => {
        await settle();
        if (fails) throw new Error('refused');
        context.state = 'suspended';
      }),
      resume: vi.fn(async () => {
        await settle();
        if (fails) throw new Error('refused');
        context.state = 'running';
      }),
    };
    return context;
  }

  async function runtimeOn(rawContext: object) {
    vi.doMock('tone', () => ({ getContext: () => ({ rawContext }) }));
    return import('../src/tone-runtime');
  }

  it('suspends a running context and resumes a suspended one, once each', async () => {
    const context = fakeContext('running');
    const { setToneSuspended } = await runtimeOn(context);

    await setToneSuspended(true);
    await setToneSuspended(true);
    expect(context.suspend).toHaveBeenCalledOnce();
    expect(context.state).toBe('suspended');

    await setToneSuspended(false);
    await setToneSuspended(false);
    expect(context.resume).toHaveBeenCalledOnce();
    expect(context.state).toBe('running');
  });

  it('ends in the latest request when opposite ones arrive before the first transition settles', async () => {
    const context = fakeContext('running', false, true);
    const { setToneSuspended } = await runtimeOn(context);

    // Backgrounded and straight back: the second request comes while suspend() is in flight,
    // when the context still reads 'running'.
    const away = setToneSuspended(true);
    const back = setToneSuspended(false);
    await Promise.all([away, back]);
    expect(context.state).toBe('running');

    const backAgain = setToneSuspended(false);
    const awayAgain = setToneSuspended(true);
    await Promise.all([backAgain, awayAgain]);
    expect(context.state).toBe('suspended');
  });

  it('leaves a closed, offline or refusing context alone without throwing', async () => {
    const closed = fakeContext('closed');
    await (await runtimeOn(closed)).setToneSuspended(false);
    expect(closed.resume).not.toHaveBeenCalled();
    vi.resetModules();

    // An OfflineAudioContext has suspend(suspendTime) and resume() too; a paused render is not
    // the app's to resume.
    const offline = { ...fakeContext('suspended'), startRendering: vi.fn() };
    await expect((await runtimeOn(offline)).setToneSuspended(false)).resolves.toBeUndefined();
    expect(offline.resume).not.toHaveBeenCalled();
    vi.resetModules();

    const refusing = fakeContext('running', true);
    await expect((await runtimeOn(refusing)).setToneSuspended(true)).resolves.toBeUndefined();
    expect(refusing.state).toBe('running');
  });
});
