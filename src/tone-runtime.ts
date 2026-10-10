/**
 * Tone-specific runtime loaded only by `gesture-audio/tone-lazy` after a
 * caller starts the lifecycle. Keep this module out of its entry module's
 * static import graph: evaluating Tone may create an AudioContext.
 */

import * as Tone from 'tone';
import { buildBuses, disposeBuses, duckBus, getBuses, muteBus, setBusVolume } from './buses.js';

/**
 * The Tone bus APIs available after a lazy lifecycle has successfully
 * unlocked. This intentionally excludes the synchronous root lifecycle API.
 */
export interface ToneRuntime {
  buildBuses: typeof buildBuses;
  disposeBuses: typeof disposeBuses;
  duckBus: typeof duckBus;
  getBuses: typeof getBuses;
  muteBus: typeof muteBus;
  setBusVolume: typeof setBusVolume;
}

/** The bus runtime handed to a successful lazy bootstrap. */
export const toneRuntime: ToneRuntime = {
  buildBuses,
  disposeBuses,
  duckBus,
  getBuses,
  muteBus,
  setBusVolume,
};

/** Resume Tone's context after this module has been dynamically loaded. */
export async function startTone(): Promise<void> {
  await Tone.start();
}

/** The part of a realtime AudioContext a suspend needs; an offline context has no `suspend()`. */
interface SuspendableContext {
  readonly state: AudioContextState;
  suspend(): Promise<void>;
  resume(): Promise<void>;
}

/**
 * Suspend (`true`) or resume (`false`) Tone's AudioContext, the Tone side of
 * `setAudioSuspended`: when an app is backgrounded the audio clock freezes, so
 * scheduled notes, loops and ramps hold their place instead of running on
 * silently. A no-op when the context is closed or already in the requested
 * state; it never throws, and leaves a context that rejects the move as it is.
 */
export async function setToneSuspended(suspended: boolean): Promise<void> {
  const ctx = Tone.getContext().rawContext as unknown as Partial<SuspendableContext>;
  if (typeof ctx.suspend !== 'function' || typeof ctx.resume !== 'function') return;
  if (ctx.state === 'closed') return;
  try {
    if (suspended) {
      if (ctx.state === 'running') await ctx.suspend();
    } else if (ctx.state !== 'running') {
      await ctx.resume();
    }
  } catch {
    // A context closed mid-transition, or one the browser refuses to move,
    // is the same "nothing to do" as above.
  }
}
