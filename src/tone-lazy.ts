/**
 * `gesture-audio/tone-lazy` — defer Tone evaluation until an audio start.
 *
 * This entry intentionally has no static Tone import. Registering its gesture
 * trigger is safe during application startup; its runtime chunk is requested
 * only when a caller starts the lifecycle from a real user interaction.
 */

import type { ToneRuntime } from './tone-runtime.js';
import { type Bootstrap, createUnlockController } from './unlock-controller.js';

/** A bootstrap that receives Tone's bus runtime after Tone.start() resolves. */
export type ToneLazyBootstrap = (runtime: ToneRuntime) => ReturnType<Bootstrap>;

let runtime: ToneRuntime | null = null;

async function unlockToneRuntime(): Promise<void> {
  const loaded = await import('./tone-runtime.js');
  await loaded.startTone();
  runtime = loaded.toneRuntime;
}

function withRuntime(bootstrap: ToneLazyBootstrap): Bootstrap {
  return async () => {
    if (!runtime) throw new Error('Tone runtime was unavailable after a successful unlock');
    await bootstrap(runtime);
  };
}

const controller = createUnlockController({
  unlock: unlockToneRuntime,
  gestureEvents: ['click', 'keydown', 'touchstart'],
  logPrefix: '[gesture-audio/tone-lazy]',
});

/**
 * Dynamically load Tone, resume it, then run `bootstrap` with the bus runtime.
 * Call this from a real user-input handler when an explicit enable-sound UI is
 * preferable to the document-level gesture trigger.
 */
export function startToneLazyEngine(bootstrap: ToneLazyBootstrap): Promise<void> {
  return controller.startAudioEngine(withRuntime(bootstrap));
}

/**
 * Register a capture-phase user-gesture trigger for the lazy Tone lifecycle.
 * Failures keep the listener armed so a later real gesture can retry.
 */
export function registerToneLazyGestureTrigger(bootstrap: ToneLazyBootstrap): () => void {
  return controller.registerAudioGestureTrigger(withRuntime(bootstrap));
}

/** Returns true only after Tone and the supplied bootstrap both succeeded. */
export function isToneLazyEngineStarted(): boolean {
  return controller.isAudioEngineStarted();
}

/** Test / hot-reload only. Does not dispose Tone's global AudioContext or buses. */
export function _resetToneLazyEngine(): void {
  runtime = null;
  controller.reset();
}
