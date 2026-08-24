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
let _startPromise: Promise<void> | null = null;
let _generation = 0;
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
export async function startAudioEngine(bootstrap: () => void | Promise<void>): Promise<void> {
  if (_started) return;
  if (_startPromise) return _startPromise;

  const generation = _generation;
  const attempt = (async () => {
    // Resume / start Tone.js AudioContext (requires user gesture).
    // Do not mark the lifecycle started until caller bootstrap also succeeds:
    // autoplay policy and transient device failures must remain retryable.
    await Tone.start();
    await bootstrap();
    if (generation === _generation) _started = true;
  })();
  _startPromise = attempt;

  try {
    await attempt;
  } finally {
    if (_startPromise === attempt) _startPromise = null;
  }
}

/**
 * Register a one-shot user-gesture trigger that starts the audio engine.
 * Attaches to the document for the first click, keydown, or touchstart.
 *
 * @param bootstrap - same callback passed to startAudioEngine
 */
export function registerAudioGestureTrigger(bootstrap: () => void | Promise<void>): () => void {
  if (_started || typeof document === 'undefined') return () => undefined;
  const existing = _gestureHandlers.get(document);
  if (existing) {
    return () => {
      for (const event of GESTURE_EVENTS) {
        document.removeEventListener(event, existing, { capture: true });
      }
      if (_gestureHandlers.get(document) === existing) _gestureHandlers.delete(document);
    };
  }

  const removeHandlers = (): void => {
    for (const ev of GESTURE_EVENTS) {
      document.removeEventListener(ev, handler, { capture: true });
    }
    if (_gestureHandlers.get(document) === handler) _gestureHandlers.delete(document);
  };

  const handler = (): void => {
    startAudioEngine(bootstrap)
      .then(removeHandlers)
      .catch((err) => {
        // Keep the gesture handlers armed: a later real interaction can retry
        // after autoplay policy or a transient audio-device failure clears.
        console.warn('[gesture-audio/init] Failed to start audio engine:', err);
      });
  };

  for (const ev of GESTURE_EVENTS) {
    document.addEventListener(ev, handler, {
      once: false,
      capture: true,
      passive: true,
    });
  }

  _gestureHandlers.set(document, handler);
  return removeHandlers;
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
  _generation += 1;
  _started = false;
  _startPromise = null;
  _gestureHandlers.clear();
}
