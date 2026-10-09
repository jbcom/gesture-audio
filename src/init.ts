/**
 * Gesture-gated audio engine lifecycle (Tone.js).
 *
 * CRITICAL: Tone.js AudioContext cannot start without a user gesture.
 * This module defers all audio init until the first user interaction.
 *
 * Call flow:
 *   1. App mounts → registerAudioGestureTrigger(bootstrap) sets up a
 *      one-shot listener on click/keydown/touchstart.
 *   2. User interacts → startAudioEngine(bootstrap) called automatically.
 *   3. startAudioEngine() awaits Tone.start() then runs the caller's own
 *      `bootstrap` callback (build buses, load sprite maps, apply prefs,
 *      start ambience — whatever the game needs).
 *
 * The engine can also be started manually (e.g. from a "click to start"
 * overlay) by calling startAudioEngine(bootstrap) directly.
 *
 * The serialization/retry/gesture logic lives in `unlock-controller.ts` and is
 * shared with the Howler-only lifecycle. This module is only the Tone-specific
 * unlock step, and is imported only by the root entry point: the
 * `gesture-audio/howler` entry must never reach it.
 */

import * as Tone from 'tone';
import { type Bootstrap, createUnlockController } from './unlock-controller.js';

const controller = createUnlockController({
  unlock: () => Tone.start(),
  gestureEvents: ['click', 'keydown', 'touchstart'],
  logPrefix: '[gesture-audio/init]',
});

/**
 * Start the audio engine.
 * Safe to call multiple times — idempotent (the bootstrap only ever runs once).
 * Must be called from within a user gesture handler.
 *
 * @param bootstrap - caller-supplied async callback that builds buses, loads
 *                    sprite maps, applies persisted preferences, starts any
 *                    ambience — whatever the game needs after Tone.start().
 */
export function startAudioEngine(bootstrap: Bootstrap): Promise<void> {
  return controller.startAudioEngine(bootstrap);
}

/**
 * Register a one-shot user-gesture trigger that starts the audio engine.
 * Attaches to the document for the first click, keydown, or touchstart.
 *
 * @param bootstrap - same callback passed to startAudioEngine
 */
export function registerAudioGestureTrigger(bootstrap: Bootstrap): () => void {
  return controller.registerAudioGestureTrigger(bootstrap);
}

/**
 * Check if the audio engine has been started.
 */
export function isAudioEngineStarted(): boolean {
  return controller.isAudioEngineStarted();
}

/**
 * Reset engine state (test / hot-reload only).
 * Does NOT dispose Tone.js global context.
 */
export function _resetAudioEngine(): void {
  controller.reset();
}
