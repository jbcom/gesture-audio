import {
  type AudioPrefsSnapshot,
  type AudioPrefsStore,
  applyPersistedAudioPrefs,
  buildBuses,
  initSpriteResolver,
  playCue,
  registerAudioGestureTrigger,
  setAndPersistBusVolume,
  setResolverMasterBus,
} from 'gesture-audio';

const BUS_NAMES = ['master', 'music', 'sfx', 'voice'] as const;
const STORAGE_KEY = 'example-audio-preferences';
const DEFAULTS: AudioPrefsSnapshot = {
  audioVolumes: { master: 80, music: 65, sfx: 85, voice: 90 },
  muteOnFocusLoss: true,
};

class LocalStorageAudioPrefs implements AudioPrefsStore {
  async get(): Promise<AudioPrefsSnapshot> {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return structuredClone(DEFAULTS);
    try {
      return { ...DEFAULTS, ...(JSON.parse(saved) as AudioPrefsSnapshot) };
    } catch {
      return structuredClone(DEFAULTS);
    }
  }

  async update(patch: { audioVolumes: Record<string, number> }): Promise<void> {
    const current = await this.get();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  }
}

const preferences = new LocalStorageAudioPrefs();

export const removeAudioGestureTrigger = registerAudioGestureTrigger(async () => {
  buildBuses(BUS_NAMES);
  setResolverMasterBus('master');
  await initSpriteResolver({ strict: true });
  await applyPersistedAudioPrefs(preferences, BUS_NAMES);
});

export function playDrawerOpen(): number {
  return playCue('drawer-open', 'sfx');
}

export async function setMusicPercent(volume: number): Promise<void> {
  await setAndPersistBusVolume('music', volume, preferences);
}
