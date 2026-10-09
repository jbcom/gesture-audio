/**
 * Shared, engine-agnostic gesture-gated unlock transaction.
 *
 * Both the Tone-backed lifecycle (`init.ts`) and the Howler-only lifecycle
 * (`howler-unlock.ts`) are this controller plus a different `unlock` step.
 * It owns everything that must behave identically: one in-flight attempt
 * shared by concurrent callers, a started flag that only flips after the
 * caller's bootstrap also succeeds, retry after any failure, generation-based
 * supersession by reset, and the one-shot gesture listeners.
 *
 * This module must never import an audio engine: the Howler-only entry point
 * reaches it, and that entry's module graph is verified to be Tone-free.
 */

export type Bootstrap = () => void | Promise<void>;

export interface UnlockControllerOptions {
  /** Engine-specific step that makes the AudioContext runnable (needs a gesture). */
  unlock: () => Promise<void>;
  /** DOM events that arm the one-shot gesture trigger. */
  gestureEvents: readonly string[];
  /** Prefix for the console warning emitted when a gesture-driven attempt fails. */
  logPrefix: string;
}

export interface UnlockController {
  startAudioEngine(bootstrap: Bootstrap): Promise<void>;
  registerAudioGestureTrigger(bootstrap: Bootstrap): () => void;
  isAudioEngineStarted(): boolean;
  /** Test / hot-reload only. */
  reset(): void;
}

export function createUnlockController(options: UnlockControllerOptions): UnlockController {
  const { unlock, gestureEvents, logPrefix } = options;
  let started = false;
  let startPromise: Promise<void> | null = null;
  let generation = 0;
  const gestureHandlers = new Map<EventTarget, (ev: Event) => void>();

  async function startAudioEngine(bootstrap: Bootstrap): Promise<void> {
    if (started) return;
    if (startPromise) return startPromise;

    const attemptGeneration = generation;
    const attempt = (async () => {
      // Do not mark the lifecycle started until the caller's bootstrap also
      // succeeds: autoplay policy and transient device failures must remain
      // retryable.
      await unlock();
      await bootstrap();
      if (attemptGeneration === generation) started = true;
    })();
    startPromise = attempt;

    try {
      await attempt;
    } finally {
      if (startPromise === attempt) startPromise = null;
    }
  }

  function registerAudioGestureTrigger(bootstrap: Bootstrap): () => void {
    if (started || typeof document === 'undefined') return () => undefined;
    const existing = gestureHandlers.get(document);
    if (existing) {
      return () => {
        for (const event of gestureEvents) {
          document.removeEventListener(event, existing, { capture: true });
        }
        if (gestureHandlers.get(document) === existing) gestureHandlers.delete(document);
      };
    }

    const removeHandlers = (): void => {
      for (const event of gestureEvents) {
        document.removeEventListener(event, handler, { capture: true });
      }
      if (gestureHandlers.get(document) === handler) gestureHandlers.delete(document);
    };

    const handler = (): void => {
      startAudioEngine(bootstrap)
        .then(removeHandlers)
        .catch((err) => {
          // Keep the gesture handlers armed: a later real interaction can retry
          // after autoplay policy or a transient audio-device failure clears.
          console.warn(`${logPrefix} Failed to start audio engine:`, err);
        });
    };

    for (const event of gestureEvents) {
      document.addEventListener(event, handler, {
        once: false,
        capture: true,
        passive: true,
      });
    }

    gestureHandlers.set(document, handler);
    return removeHandlers;
  }

  function reset(): void {
    if (typeof document !== 'undefined') {
      const handler = gestureHandlers.get(document);
      if (handler) {
        for (const event of gestureEvents) {
          document.removeEventListener(event, handler, { capture: true });
        }
      }
    }
    generation += 1;
    started = false;
    startPromise = null;
    gestureHandlers.clear();
  }

  return {
    startAudioEngine,
    registerAudioGestureTrigger,
    isAudioEngineStarted: () => started,
    reset,
  };
}
