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
