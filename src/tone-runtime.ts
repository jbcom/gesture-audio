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

/** The part of a realtime AudioContext a suspend needs. */
interface SuspendableContext {
  readonly state: AudioContextState;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  /** Only an OfflineAudioContext has it (Tone's wrapped contexts defeat an `instanceof`). */
  startRendering?: unknown;
}

/** The latest request, and the reconciliation applying it while one is in flight. */
let wanted = false;
let reconciling: Promise<void> | null = null;

/**
 * Suspend (`true`) or resume (`false`) Tone's AudioContext, the Tone side of
 * `setAudioSuspended`: when an app is backgrounded the audio clock freezes, so
 * scheduled notes, loops and ramps hold their place instead of running on
 * silently. A no-op when the context is closed, offline (a paused render is
 * not the app's to resume) or already in the requested state; it never
 * throws, and leaves a context that rejects the move as it is. Requests made
 * while a transition is in flight are not lost: the context ends in the
 * latest one, and every returned promise settles once it has.
 */
export function setToneSuspended(suspended: boolean): Promise<void> {
  wanted = suspended;
  reconciling ??= reconcile();
  return reconciling;
}

async function reconcile(): Promise<void> {
  // One tick first, so every request made in the same turn is in `wanted` before the first look.
  await undefined;
  try {
    await apply();
  } finally {
    // In the same step as the last look at `wanted`: a request after this starts a new pass.
    reconciling = null;
  }
}

async function apply(): Promise<void> {
  const ctx = Tone.getContext().rawContext as unknown as Partial<SuspendableContext>;
  if (typeof ctx.suspend !== 'function' || typeof ctx.resume !== 'function') return;
  if ('startRendering' in ctx) return;
  for (;;) {
    const target = wanted;
    if (ctx.state === 'closed') return;
    try {
      if (target) {
        if (ctx.state === 'running') await ctx.suspend();
      } else if (ctx.state !== 'running') {
        await ctx.resume();
      }
    } catch {
      // A context closed mid-transition, or one the browser refuses to move,
      // is the same "nothing to do" as above.
      if (wanted === target) return;
    }
    // A request that came in during the transition is applied next.
    if (wanted === target) return;
  }
}
