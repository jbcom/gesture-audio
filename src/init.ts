/**
 * Gesture-gated audio engine lifecycle.
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
 */

import * as Tone from 'tone';

let _started = false;
const _gestureHandlers = new Map<EventTarget, (ev: Event) => void>();

const GESTURE_EVENTS = ['click', 'keydown', 'touchstart'] as const;

/**
 * Start the audio engine.
 * Safe to call multiple times — idempotent (the bootstrap only ever runs once).
 * Must be called from within a user gesture handler.
 *
 * @param bootstrap - caller-supplied async callback that builds buses, loads
 *                    sprite maps, applies persisted preferences, starts any
 *                    ambience — whatever the game needs after Tone.start().
 */
export async function startAudioEngine(bootstrap: () => Promise<void>): Promise<void> {
  if (_started) return;
  _started = true;

  // Resume / start Tone.js AudioContext (requires user gesture)
  await Tone.start();

  await bootstrap();
}

/**
 * Register a one-shot user-gesture trigger that starts the audio engine.
 * Attaches to the document for the first click, keydown, or touchstart.
 *
 * @param bootstrap - same callback passed to startAudioEngine
 */
export function registerAudioGestureTrigger(bootstrap: () => Promise<void>): void {
  if (_started || typeof document === 'undefined') return;

  const handler = (): void => {
    startAudioEngine(bootstrap).catch((err) => {
      console.warn('[audio-engine/init] Failed to start audio engine:', err);
    });
    for (const ev of GESTURE_EVENTS) {
      document.removeEventListener(ev, handler, { capture: true });
    }
    _gestureHandlers.delete(document);
  };

  for (const ev of GESTURE_EVENTS) {
    document.addEventListener(ev, handler, {
      once: false,
      capture: true,
      passive: true,
    });
  }

  _gestureHandlers.set(document, handler);
}

/**
 * Check if the audio engine has been started.
 */
export function isAudioEngineStarted(): boolean {
  return _started;
}

/**
 * Reset engine state (test / hot-reload only).
 * Does NOT dispose Tone.js global context.
 */
export function _resetAudioEngine(): void {
  if (typeof document !== 'undefined') {
    const handler = _gestureHandlers.get(document);
    if (handler) {
      for (const ev of GESTURE_EVENTS) {
        document.removeEventListener(ev, handler, { capture: true });
      }
    }
  }
  _started = false;
  _gestureHandlers.clear();
}
