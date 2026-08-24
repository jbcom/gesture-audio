/**
 * Howler-backed sprite resolver.
 *
 * Loads a sprite-map JSON (produced by a game's own audio-fetch build step)
 * and exposes a playCue() interface that routes audio through per-bus
 * volume/mute state (set via setResolverVolume/setResolverMute — typically
 * mirrored 1:1 from the Tone.js bus topology in buses.ts).
 *
 * Sprite map format:
 *   {
 *     "ui/sprite": {
 *       "drawer-open": { "start_ms": 0, "end_ms": 450, "file": "ui/sprite" },
 *       ...
 *     }
 *   }
 *
 * Flat cue map format (alternative output shape):
 *   {
 *     "drawer-open": { "start_ms": 0, "end_ms": 450, "file": "ui/sprite" },
 *     ...
 *   }
 *
 * Falls back gracefully when the sprite map is absent (no-op + warn).
 */

import { Howl } from 'howler';

/**
 * A single cue's location within a sprite-sheet audio file, as produced by
 * a game's own audio-fetch build step (see the module-level sprite map
 * format comment above).
 */
export interface SpriteEntry {
  /** Offset in milliseconds where this cue's audio begins within `file`. */
  start_ms: number;
  /** Offset in milliseconds where this cue's audio ends within `file`. */
  end_ms: number;
  /** Sprite-sheet file this cue belongs to (relative to `audioBaseUrl`, without extension). */
  file: string;
}

/** Flat map: cueName → sprite entry */
export type SpriteMap = Record<string, SpriteEntry>;

/** Nested map: spriteFile → { cueName → entry } */
export type NestedSpriteMap = Record<string, Record<string, SpriteEntry>>;

export interface SpriteResolverOptions {
  /** URL to fetch the sprite map JSON from. Default: '/audio/sprite-map.json' */
  spriteMapUrl?: string;
  /**
   * File extensions to probe for each sprite sheet, in preference order.
   * Passed straight to Howler's `src` array as `${audioBaseUrl}/${file}.${ext}`.
   * Default: ['webm', 'm4a']
   */
  formats?: string[];
  /**
   * Base URL sprite-sheet files are resolved relative to.
   * Default: '/audio'
   */
  audioBaseUrl?: string;
}

const DEFAULT_SPRITE_MAP_URL = '/audio/sprite-map.json';
const DEFAULT_FORMATS = ['webm', 'm4a'];
const DEFAULT_AUDIO_BASE_URL = '/audio';

/**
 * Active Howl instances keyed by sprite-file path.
 * One Howl per sprite sheet (shared across all cues in that sheet).
 */
const _howls = new Map<string, Howl>();

/** Flat cue → entry map populated on init */
let _cueMap: SpriteMap = {};

/** Whether init completed (even if no sprite-map found) */
let _ready = false;

/** Per-bus volume overrides (0–1 linear), applied to new plays. Buses register lazily. */
const _busVolumes = new Map<string, number>();

/** Per-bus mute flags. Buses register lazily. */
const _busMuted = new Map<string, boolean>();

/** Name of the bus treated as the "master" override — mutes/scales everything. */
let _masterBus: string | null = null;

function _effectiveVolume(busTarget: string): number {
  if (_masterBus && _busMuted.get(_masterBus)) return 0;
  if (_busMuted.get(busTarget)) return 0;
  const masterVol = _masterBus ? (_busVolumes.get(_masterBus) ?? 1) : 1;
  const busVol = _busVolumes.get(busTarget) ?? 1;
  return masterVol * busVol;
}

/**
 * Load and flatten a sprite-map response into a flat SpriteMap.
 * Handles both flat {cueName: entry} and nested {spriteFile: {cueName: entry}}.
 */
function _flattenMap(raw: unknown): SpriteMap {
  if (typeof raw !== 'object' || raw === null) return {};
  const obj = raw as Record<string, unknown>;

  // Detect nested: first value is also an object without start_ms
  const firstVal = Object.values(obj)[0];
  if (firstVal !== null && typeof firstVal === 'object' && !('start_ms' in (firstVal as object))) {
    const flat: SpriteMap = {};
    for (const entries of Object.values(obj)) {
      if (typeof entries === 'object' && entries !== null) {
        for (const [cue, entry] of Object.entries(entries as Record<string, unknown>)) {
          flat[cue] = entry as SpriteEntry;
        }
      }
    }
    return flat;
  }

  return obj as SpriteMap;
}

/**
 * Build a Howler sprite definition from all entries sharing the same file.
 */
function _buildHowlForFile(
  file: string,
  entries: SpriteEntry[],
  cueMap: SpriteMap,
  formats: string[],
  audioBaseUrl: string,
): Howl {
  const spriteObj: Record<string, [number, number]> = {};
  for (const entry of entries) {
    const cue = Object.entries(cueMap).find(([, e]) => e === entry)?.[0];
    if (cue) {
      spriteObj[cue] = [entry.start_ms, entry.end_ms - entry.start_ms];
    }
  }

  const src = formats.map((ext) => `${audioBaseUrl}/${file}.${ext}`);

  return new Howl({
    src,
    sprite: spriteObj,
    preload: true,
    html5: false, // Web Audio API for low latency
  });
}

let _lastOptions: Required<SpriteResolverOptions> = {
  spriteMapUrl: DEFAULT_SPRITE_MAP_URL,
  formats: DEFAULT_FORMATS,
  audioBaseUrl: DEFAULT_AUDIO_BASE_URL,
};

/**
 * Initialise the sprite resolver.
 * Safe to call multiple times — idempotent.
 * Resolves even if the sprite map is absent (warns, no-op on play).
 */
export async function initSpriteResolver(opts: SpriteResolverOptions = {}): Promise<void> {
  if (_ready) return;

  const spriteMapUrl = opts.spriteMapUrl ?? DEFAULT_SPRITE_MAP_URL;
  const formats = opts.formats ?? DEFAULT_FORMATS;
  const audioBaseUrl = opts.audioBaseUrl ?? DEFAULT_AUDIO_BASE_URL;
  _lastOptions = { spriteMapUrl, formats, audioBaseUrl };

  try {
    const res = await fetch(spriteMapUrl);
    if (!res.ok) {
      console.warn(
        `[gesture-audio/sprite-resolver] sprite map not found (${res.status}) — audio cues disabled`,
      );
      _ready = true;
      return;
    }
    const raw: unknown = await res.json();
    _cueMap = _flattenMap(raw);

    // Group entries by file and build one Howl per file
    const byFile = new Map<string, SpriteEntry[]>();
    for (const entry of Object.values(_cueMap)) {
      const list = byFile.get(entry.file) ?? [];
      list.push(entry);
      byFile.set(entry.file, list);
    }
    for (const [file, entries] of byFile) {
      _howls.set(file, _buildHowlForFile(file, entries, _cueMap, formats, audioBaseUrl));
    }
  } catch (err) {
    console.warn(
      '[gesture-audio/sprite-resolver] Failed to load sprite map — audio cues disabled',
      err,
    );
  }

  _ready = true;
}

/**
 * Play a cue by name, routed to the given bus.
 * @returns Howler sound id, or -1 if unavailable.
 */
export function playCue(cueName: string, busTarget = 'sfx'): number {
  if (!_ready) {
    console.warn(
      '[gesture-audio/sprite-resolver] resolver not initialised; call initSpriteResolver() first',
    );
    return -1;
  }

  const entry = _cueMap[cueName];
  if (!entry) {
    // Silent no-op for missing cues — content may not have landed all cues yet
    return -1;
  }

  const howl = _howls.get(entry.file);
  if (!howl) return -1;

  const vol = _effectiveVolume(busTarget);
  const id = howl.play(cueName);
  howl.volume(vol, id);
  return id;
}

/**
 * Stop a sound by Howler id.
 */
export function stopCue(id: number): void {
  if (id < 0) return;
  for (const howl of _howls.values()) {
    howl.stop(id);
  }
}

/**
 * Set volume for a named bus (0–1 linear).
 * Affects subsequent playCue calls; does not retroactively adjust active sounds.
 *
 * The first bus name ever passed to setResolverVolume/setResolverMute is NOT
 * automatically treated as master — call `setResolverMasterBus(name)` once
 * (or rely on buses.ts naming its master bus 'master' by convention, which
 * setAndPersistBusVolume/applyPersistedAudioPrefs in preferences-bridge.ts do).
 */
export function setResolverVolume(bus: string, linear: number): void {
  _busVolumes.set(bus, Math.max(0, Math.min(1, linear)));
}

/**
 * Mute / unmute a named bus.
 */
export function setResolverMute(bus: string, muted: boolean): void {
  _busMuted.set(bus, muted);
}

/**
 * Designate which bus name acts as the "master" override for the resolver
 * (mutes/scales all cue playback regardless of target bus). Optional — if
 * never called, only per-target-bus mute/volume applies.
 */
export function setResolverMasterBus(bus: string | null): void {
  _masterBus = bus;
}

/**
 * Dispose all Howl instances. Used in tests and hot-reload.
 */
export function disposeSpriteResolver(): void {
  for (const howl of _howls.values()) {
    howl.unload();
  }
  _howls.clear();
  _cueMap = {};
  _busVolumes.clear();
  _busMuted.clear();
  _masterBus = null;
  _ready = false;
}

/** Exposed for testing. */
export function _getCueMap(): SpriteMap {
  return { ..._cueMap };
}

/** Exposed for testing/introspection. */
export function _getLastResolverOptions(): Required<SpriteResolverOptions> {
  return _lastOptions;
}
