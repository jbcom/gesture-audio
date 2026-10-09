/**
 * Tests: src/audio-context.ts (setAudioSuspended). Howler is mocked with a
 * controllable AudioContext.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeContext {
  state: string;
  suspend: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
}

const howler = vi.hoisted(() => ({
  usingWebAudio: true,
  ctx: null as null | FakeContext,
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
  },
}));

import { setAudioSuspended } from '../src/howler';

function newContext(state: string): FakeContext {
  const ctx: FakeContext = {
    state,
    suspend: vi.fn(async () => {
      ctx.state = 'suspended';
    }),
    resume: vi.fn(async () => {
      ctx.state = 'running';
    }),
  };
  return ctx;
}

describe('setAudioSuspended', () => {
  beforeEach(() => {
    howler.usingWebAudio = true;
    howler.ctx = null;
  });

  it('suspends a running context and resumes it again', async () => {
    const ctx = newContext('running');
    howler.ctx = ctx;
    await setAudioSuspended(true);
    expect(ctx.suspend).toHaveBeenCalledOnce();
    expect(ctx.state).toBe('suspended');
    await setAudioSuspended(false);
    expect(ctx.resume).toHaveBeenCalledOnce();
    expect(ctx.state).toBe('running');
  });

  it('does nothing when the context is already in the requested state', async () => {
    const running = newContext('running');
    howler.ctx = running;
    await setAudioSuspended(false);
    expect(running.resume).not.toHaveBeenCalled();
    const suspended = newContext('suspended');
    howler.ctx = suspended;
    await setAudioSuspended(true);
    expect(suspended.suspend).not.toHaveBeenCalled();
  });

  it('resumes an interrupted context', async () => {
    const ctx = newContext('interrupted');
    howler.ctx = ctx;
    await setAudioSuspended(false);
    expect(ctx.resume).toHaveBeenCalledOnce();
  });

  it('is a no-op before Howler has created its context', async () => {
    await expect(setAudioSuspended(true)).resolves.toBeUndefined();
    await expect(setAudioSuspended(false)).resolves.toBeUndefined();
  });

  it('is a no-op when Howler has fallen back to HTML5 Audio', async () => {
    const ctx = newContext('running');
    howler.ctx = ctx;
    howler.usingWebAudio = false;
    await setAudioSuspended(true);
    expect(ctx.suspend).not.toHaveBeenCalled();
  });

  it('is a no-op on a closed context', async () => {
    const ctx = newContext('closed');
    howler.ctx = ctx;
    await setAudioSuspended(true);
    await setAudioSuspended(false);
    expect(ctx.suspend).not.toHaveBeenCalled();
    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it('never throws when the context rejects the transition', async () => {
    const ctx = newContext('running');
    ctx.suspend.mockRejectedValueOnce(new DOMException('closed', 'InvalidStateError'));
    howler.ctx = ctx;
    await expect(setAudioSuspended(true)).resolves.toBeUndefined();
    ctx.state = 'suspended';
    ctx.resume.mockRejectedValueOnce(new DOMException('closed', 'InvalidStateError'));
    await expect(setAudioSuspended(false)).resolves.toBeUndefined();
  });
});
