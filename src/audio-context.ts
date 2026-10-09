/**
 * Suspend / resume Howler's AudioContext, so an application never has to
 * import `howler` itself just to pause audio while it is backgrounded.
 *
 * Imports only `howler`: this module is part of the Tone-free
 * `gesture-audio/howler` graph.
 */

import { Howler } from 'howler';

/**
 * Suspend (`true`) or resume (`false`) Howler's AudioContext, e.g. when an app
 * is backgrounded or foregrounded. Suspending freezes the audio clock, so
 * playing sprites, loops and fades hold their position rather than running on
 * silently.
 *
 * A no-op when there is nothing to act on: before Howler has created its
 * context, when Howler fell back to HTML5 Audio, when the context is already
 * in the requested state, and after the context has been closed. It never
 * throws; a context that rejects the transition is left as it is. Resuming
 * outside a user gesture may stay pending until the browser allows it.
 */
export async function setAudioSuspended(suspended: boolean): Promise<void> {
  const ctx = Howler.usingWebAudio ? Howler.ctx : null;
  if (!ctx || ctx.state === 'closed') return;
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
