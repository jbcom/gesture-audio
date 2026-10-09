/**
 * Gesture-gated audio engine lifecycle for Howler-only applications.
 *
 * Same contract as the Tone-backed lifecycle in `init.ts`
 * (`registerAudioGestureTrigger` / `startAudioEngine` / `isAudioEngineStarted`
 * / `_resetAudioEngine`), but the unlock step resumes Howler's own
 * AudioContext and nothing here (or anything it imports) touches Tone.js, so
 * the page ends up with exactly one AudioContext.
 *
 * Howler creates its context lazily. Its public `Howler.volume()` getter runs
 * that setup when no context exists yet, which is how the context is created
 * here from inside the gesture instead of reaching into Howler's internals.
 */

import { Howler } from 'howler';
import { type Bootstrap, createUnlockController } from './unlock-controller.js';

async function resumeHowlerContext(): Promise<void> {
  if (!Howler.ctx && Howler.usingWebAudio) Howler.volume();
  // Howler falls back to HTML5 Audio (no context) when Web Audio is missing;
  // there is nothing to resume then, and the bootstrap still runs.
  const ctx = Howler.usingWebAudio ? Howler.ctx : null;
  if (ctx && ctx.state !== 'running') await ctx.resume();
}

const controller = createUnlockController({
  unlock: resumeHowlerContext,
  gestureEvents: ['click', 'keydown', 'touchstart', 'pointerdown'],
  logPrefix: '[gesture-audio/howler-unlock]',
});

/**
 * Start the audio engine: resume Howler's AudioContext (creating it if Howler
 * has not yet), then run `bootstrap`. Idempotent, shared across concurrent
 * callers, and retryable after a failed resume or bootstrap. Must be called
 * from within a user gesture handler.
 */
export function startAudioEngine(bootstrap: Bootstrap): Promise<void> {
  return controller.startAudioEngine(bootstrap);
}

/**
 * Register a one-shot gesture trigger that starts the audio engine on the
 * first click, keydown, touchstart or pointerdown. Returns a cleanup function.
 */
export function registerAudioGestureTrigger(bootstrap: Bootstrap): () => void {
  return controller.registerAudioGestureTrigger(bootstrap);
}

/** Check if the audio engine has been started. */
export function isAudioEngineStarted(): boolean {
  return controller.isAudioEngineStarted();
}

/** Reset engine state (test / hot-reload only). Does not close Howler's context. */
export function _resetAudioEngine(): void {
  controller.reset();
}
