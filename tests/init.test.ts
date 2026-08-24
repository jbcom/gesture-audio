/**
 * Tests: src/init.ts
 *
 * Verifies user-gesture gating and idempotency of the generic gesture-gated
 * lifecycle. The caller's `bootstrap` callback (building buses, loading
 * sprite maps, applying preferences, etc.) is a plain mock here — those
 * concerns are the caller's own, not this module's.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('tone', () => ({
  start: vi.fn().mockResolvedValue(undefined),
}));

import {
  _resetAudioEngine,
  isAudioEngineStarted,
  registerAudioGestureTrigger,
  startAudioEngine,
} from '../src';

describe('startAudioEngine', () => {
  beforeEach(async () => {
    _resetAudioEngine();
    vi.clearAllMocks();
    const { start } = await import('tone');
    vi.mocked(start).mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    _resetAudioEngine();
  });

  it('starts without throwing', async () => {
    const bootstrap = vi.fn().mockResolvedValue(undefined);
    await expect(startAudioEngine(bootstrap)).resolves.toBeUndefined();
  });

  it('marks engine as started', async () => {
    const bootstrap = vi.fn().mockResolvedValue(undefined);
    expect(isAudioEngineStarted()).toBe(false);
    await startAudioEngine(bootstrap);
    expect(isAudioEngineStarted()).toBe(true);
  });

  it('is idempotent — calling twice does not double-start or re-run bootstrap', async () => {
    const { start } = await import('tone');
    const bootstrap = vi.fn().mockResolvedValue(undefined);
    await startAudioEngine(bootstrap);
    await startAudioEngine(bootstrap);
    expect(vi.mocked(start)).toHaveBeenCalledTimes(1);
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it('calls Tone.start() (requires user gesture)', async () => {
    const { start } = await import('tone');
    const bootstrap = vi.fn().mockResolvedValue(undefined);
    await startAudioEngine(bootstrap);
    expect(vi.mocked(start)).toHaveBeenCalledTimes(1);
  });

  it('calls the bootstrap callback after Tone.start()', async () => {
    const { start } = await import('tone');
    const order: string[] = [];
    vi.mocked(start).mockImplementationOnce(async () => {
      order.push('tone-start');
    });
    const bootstrap = vi.fn(async () => {
      order.push('bootstrap');
    });
    await startAudioEngine(bootstrap);
    expect(order).toEqual(['tone-start', 'bootstrap']);
  });

  it('accepts a synchronous bootstrap callback', async () => {
    const bootstrap = vi.fn();
    await expect(startAudioEngine(bootstrap)).resolves.toBeUndefined();
    expect(bootstrap).toHaveBeenCalledOnce();
  });

  it('leaves bootstrap failures retryable', async () => {
    const bootstrap = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    await expect(startAudioEngine(bootstrap)).rejects.toThrow('boom');
    expect(isAudioEngineStarted()).toBe(false);
    await expect(startAudioEngine(bootstrap)).resolves.toBeUndefined();
    expect(isAudioEngineStarted()).toBe(true);
    expect(bootstrap).toHaveBeenCalledTimes(2);
  });

  it('leaves Tone unlock failures retryable', async () => {
    const { start } = await import('tone');
    vi.mocked(start).mockRejectedValueOnce(new Error('locked')).mockResolvedValueOnce(undefined);
    const bootstrap = vi.fn().mockResolvedValue(undefined);
    await expect(startAudioEngine(bootstrap)).rejects.toThrow('locked');
    expect(isAudioEngineStarted()).toBe(false);
    expect(bootstrap).not.toHaveBeenCalled();
    await expect(startAudioEngine(bootstrap)).resolves.toBeUndefined();
    expect(isAudioEngineStarted()).toBe(true);
  });

  it('does not mark a stale in-flight attempt as started after a reset supersedes it', async () => {
    const { start } = await import('tone');
    let release: (() => void) | undefined;
    vi.mocked(start).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const bootstrap = vi.fn().mockResolvedValue(undefined);
    const attempt = startAudioEngine(bootstrap);

    // Reset bumps the generation counter while the attempt above is still
    // in-flight (Tone.start() has not resolved yet).
    _resetAudioEngine();
    vi.mocked(start).mockReset().mockResolvedValue(undefined);

    release?.();
    await attempt;

    // The superseded attempt's generation no longer matches, so it must not
    // have flipped `_started` to true.
    expect(isAudioEngineStarted()).toBe(false);
  });

  it('shares one in-flight unlock across concurrent callers', async () => {
    const { start } = await import('tone');
    let release: (() => void) | undefined;
    vi.mocked(start).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const bootstrap = vi.fn().mockResolvedValue(undefined);
    const first = startAudioEngine(bootstrap);
    const second = startAudioEngine(bootstrap);
    release?.();
    await Promise.all([first, second]);
    expect(start).toHaveBeenCalledTimes(1);
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });
});

describe('registerAudioGestureTrigger', () => {
  beforeEach(async () => {
    _resetAudioEngine();
    const { start } = await import('tone');
    vi.mocked(start).mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    _resetAudioEngine();
  });

  it('does not start engine immediately (no user gesture yet)', () => {
    const bootstrap = vi.fn().mockResolvedValue(undefined);
    registerAudioGestureTrigger(bootstrap);
    expect(isAudioEngineStarted()).toBe(false);
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it('starts the engine on a synthetic click gesture', async () => {
    const bootstrap = vi.fn().mockResolvedValue(undefined);
    registerAudioGestureTrigger(bootstrap);
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(isAudioEngineStarted()).toBe(true);
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it('removes listeners after the first gesture fires', async () => {
    const bootstrap = vi.fn().mockResolvedValue(undefined);
    registerAudioGestureTrigger(bootstrap);
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it('keeps listeners armed after a failed unlock so a later gesture retries', async () => {
    const { start } = await import('tone');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(start).mockRejectedValueOnce(new Error('locked')).mockResolvedValueOnce(undefined);
    const bootstrap = vi.fn().mockResolvedValue(undefined);
    registerAudioGestureTrigger(bootstrap);

    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(isAudioEngineStarted()).toBe(false);
    expect(bootstrap).not.toHaveBeenCalled();

    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(isAudioEngineStarted()).toBe(true);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    warning.mockRestore();
  });

  it('does not register duplicate gesture handlers', async () => {
    const bootstrap = vi.fn().mockResolvedValue(undefined);
    registerAudioGestureTrigger(bootstrap);
    registerAudioGestureTrigger(bootstrap);
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it('lets a duplicate registration return cleanup for the existing handler', async () => {
    const firstBootstrap = vi.fn().mockResolvedValue(undefined);
    registerAudioGestureTrigger(firstBootstrap);
    const removeExisting = registerAudioGestureTrigger(vi.fn().mockResolvedValue(undefined));
    removeExisting();
    document.dispatchEvent(new Event('click'));
    await Promise.resolve();
    expect(firstBootstrap).not.toHaveBeenCalled();
  });

  it('returns a cleanup function that removes gesture listeners', async () => {
    const bootstrap = vi.fn().mockResolvedValue(undefined);
    const cleanup = registerAudioGestureTrigger(bootstrap);
    cleanup();
    document.dispatchEvent(new Event('click'));
    await Promise.resolve();
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it('does not let a stale repeated cleanup evict a live registration and attach a duplicate listener', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener');

    const firstBootstrap = vi.fn().mockResolvedValue(undefined);
    const staleCleanup = registerAudioGestureTrigger(firstBootstrap);
    staleCleanup(); // removes first's listeners, clears the registry entry

    const secondBootstrap = vi.fn().mockResolvedValue(undefined);
    registerAudioGestureTrigger(secondBootstrap); // registry entry: second's handler
    const addCallsAfterSecond = addSpy.mock.calls.length;

    // A second, stale call to the first cleanup (e.g. an unmounted
    // component's effect teardown firing twice) must not clear the registry
    // entry again — second's handler is still live on the DOM. If it does,
    // the registry looks empty and a third registration below believes none
    // exists, attaching a second, redundant set of DOM listeners alongside
    // second's still-live ones.
    staleCleanup();

    const thirdBootstrap = vi.fn().mockResolvedValue(undefined);
    registerAudioGestureTrigger(thirdBootstrap);

    // No new addEventListener calls — the third registration must see
    // second's handler as `existing` and skip attaching its own.
    expect(addSpy.mock.calls.length).toBe(addCallsAfterSecond);

    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(isAudioEngineStarted()).toBe(true);
    expect(secondBootstrap).toHaveBeenCalledTimes(1);

    addSpy.mockRestore();
  });
});
