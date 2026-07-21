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

import { _resetAudioEngine, isAudioEngineStarted, registerAudioGestureTrigger, startAudioEngine } from '../src';

describe('startAudioEngine', () => {
  beforeEach(() => {
    _resetAudioEngine();
    vi.clearAllMocks();
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

  it('propagates a bootstrap rejection but leaves the engine marked started (idempotent guard already set)', async () => {
    const bootstrap = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(startAudioEngine(bootstrap)).rejects.toThrow('boom');
  });
});

describe('registerAudioGestureTrigger', () => {
  beforeEach(() => {
    _resetAudioEngine();
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
});
