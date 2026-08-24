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
  /** Throw on fetch or validation failures instead of degrading to an empty resolver. */
  strict?: boolean;
}

const DEFAULT_SPRITE_MAP_URL = '/audio/sprite-map.json';
const DEFAULT_FORMATS = ['webm', 'm4a'];
const DEFAULT_AUDIO_BASE_URL = '/audio';

/**
 * Active Howl instances keyed by sprite-file path.
 * One Howl per sprite sheet (shared across all cues in that sheet).
 */
const _howls = new Map<string, Howl>();
const _activeSounds = new Map<number, { howl: Howl; bus: string }>();

/** Flat cue → entry map populated on init */
let _cueMap: SpriteMap = {};

/** Whether init completed (even if no sprite-map found) */
let _ready = false;

/** Per-bus volume overrides (0–1 linear), applied to active and future plays. */
const _busVolumes = new Map<string, number>();

/** Independently reversible per-bus mute layers. Buses register lazily. */
const _muteReasons = new Map<string, Set<string>>();

/** Name of the bus treated as the "master" override — mutes/scales everything. */
let _masterBus: string | null = null;
let _initPromise: Promise<void> | null = null;
let _generation = 0;

const MANUAL_MUTE_REASON = 'manual';

function _effectiveVolume(busTarget: string): number {
  if (_masterBus && (_muteReasons.get(_masterBus)?.size ?? 0) > 0) return 0;
  if ((_muteReasons.get(busTarget)?.size ?? 0) > 0) return 0;
  const masterVol = _masterBus ? (_busVolumes.get(_masterBus) ?? 1) : 1;
  const busVol = _busVolumes.get(busTarget) ?? 1;
  return masterVol * busVol;
}

function isSpriteEntry(value: unknown): value is SpriteEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<SpriteEntry>;
  return (
    Number.isFinite(entry.start_ms) &&
    Number.isFinite(entry.end_ms) &&
    (entry.start_ms ?? -1) >= 0 &&
    (entry.end_ms ?? 0) > (entry.start_ms ?? 0) &&
    typeof entry.file === 'string' &&
    entry.file.trim().length > 0
  );
}

/**
 * Load and flatten a sprite-map response into a flat SpriteMap.
 * Handles both flat {cueName: entry} and nested {spriteFile: {cueName: entry}}.
 */
function _flattenMap(raw: unknown): { map: SpriteMap; warnings: string[] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { map: {}, warnings: ['sprite map must be a JSON object'] };
  }
  const obj = raw as Record<string, unknown>;
  const flat: SpriteMap = {};
  const warnings: string[] = [];
  const topLevelEntries = Object.entries(obj);
  const flatShape = topLevelEntries.some(([, value]) => isSpriteEntry(value));

  const addEntry = (cue: string, value: unknown, context: string): void => {
    if (cue.trim().length === 0 || !isSpriteEntry(value)) {
      warnings.push(`${context}: invalid cue entry`);
      return;
    }
    if (flat[cue]) {
      warnings.push(`${context}: duplicate cue name "${cue}"`);
      return;
    }
    flat[cue] = { ...value };
  };

  if (flatShape) {
    for (const [cue, entry] of topLevelEntries) addEntry(cue, entry, cue);
  } else {
    for (const [group, entries] of topLevelEntries) {
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
        warnings.push(`${group}: expected an object of cue entries`);
        continue;
      }
      for (const [cue, entry] of Object.entries(entries as Record<string, unknown>)) {
        addEntry(cue, entry, `${group}.${cue}`);
      }
    }
  }
  return { map: flat, warnings };
}

/**
 * Build a Howler sprite definition from all entries sharing the same file.
 */
function _buildHowlForFile(
  file: string,
  entries: Array<[string, SpriteEntry]>,
  formats: string[],
  audioBaseUrl: string,
): Howl {
  const spriteObj: Record<string, [number, number]> = {};
  for (const [cue, entry] of entries) {
    spriteObj[cue] = [entry.start_ms, entry.end_ms - entry.start_ms];
  }

  const base = audioBaseUrl.replace(/\/$/, '');
  const relativeFile = file.replace(/^\/+/, '');
  const src = formats.map((ext) => `${base}/${relativeFile}.${ext}`);

  return new Howl({
    src,
    sprite: spriteObj,
    preload: true,
    html5: false, // Web Audio API for low latency
  });
}

type NormalizedResolverOptions = Required<SpriteResolverOptions>;

let _lastOptions: NormalizedResolverOptions = {
  spriteMapUrl: DEFAULT_SPRITE_MAP_URL,
  formats: DEFAULT_FORMATS,
  audioBaseUrl: DEFAULT_AUDIO_BASE_URL,
  strict: false,
};

function normalizeOptions(opts: SpriteResolverOptions): NormalizedResolverOptions {
  const formats = opts.formats ?? DEFAULT_FORMATS;
  if (formats.length === 0 || formats.some((format) => !/^[a-z0-9]+$/i.test(format))) {
    throw new TypeError(
      'formats must contain at least one extension using only letters and digits',
    );
  }
  const spriteMapUrl = opts.spriteMapUrl ?? DEFAULT_SPRITE_MAP_URL;
  const audioBaseUrl = opts.audioBaseUrl ?? DEFAULT_AUDIO_BASE_URL;
  if (spriteMapUrl.trim().length === 0) throw new TypeError('spriteMapUrl must not be empty');
  if (audioBaseUrl.trim().length === 0) throw new TypeError('audioBaseUrl must not be empty');
  return { spriteMapUrl, formats: [...formats], audioBaseUrl, strict: opts.strict ?? false };
}

function optionsEqual(a: NormalizedResolverOptions, b: NormalizedResolverOptions): boolean {
  return (
    a.spriteMapUrl === b.spriteMapUrl &&
    a.audioBaseUrl === b.audioBaseUrl &&
    a.strict === b.strict &&
    a.formats.length === b.formats.length &&
    a.formats.every((format, index) => format === b.formats[index])
  );
}

/**
 * Initialise the sprite resolver.
 * Concurrent calls with the same options share one attempt. Calls with
 * different options require disposal first.
 * Resolves even if the sprite map is absent unless `strict` is enabled.
 */
export async function initSpriteResolver(opts: SpriteResolverOptions = {}): Promise<void> {
  const normalized = normalizeOptions(opts);
  if ((_ready || _initPromise) && !optionsEqual(normalized, _lastOptions)) {
    throw new Error(
      'Sprite resolver is already initialized with different options; dispose it first',
    );
  }
  if (_ready) return;
  if (_initPromise) return _initPromise;
  _lastOptions = normalized;
  const generation = _generation;

  const attempt = (async () => {
    const createdHowls = new Map<string, Howl>();
    try {
      const res = await fetch(normalized.spriteMapUrl);
      if (!res.ok) {
        throw new Error(`sprite map request failed with HTTP ${res.status}`);
      }
      const raw: unknown = await res.json();
      const parsed = _flattenMap(raw);
      if (parsed.warnings.length > 0) {
        const message = `Invalid sprite map: ${parsed.warnings.join('; ')}`;
        if (normalized.strict) throw new Error(message);
        console.warn(`[gesture-audio/sprite-resolver] ${message}`);
      }
      // Group entries by file and build one Howl per file
      const byFile = new Map<string, Array<[string, SpriteEntry]>>();
      for (const [cue, entry] of Object.entries(parsed.map)) {
        const list = byFile.get(entry.file) ?? [];
        list.push([cue, entry]);
        byFile.set(entry.file, list);
      }
      for (const [file, entries] of byFile) {
        createdHowls.set(
          file,
          _buildHowlForFile(file, entries, normalized.formats, normalized.audioBaseUrl),
        );
      }
      if (generation !== _generation) {
        for (const howl of createdHowls.values()) howl.unload();
        return;
      }
      _cueMap = parsed.map;
      for (const [file, howl] of createdHowls) _howls.set(file, howl);
      _ready = true;
    } catch (err) {
      for (const howl of createdHowls.values()) howl.unload();
      if (generation !== _generation) return;
      _cueMap = {};
      if (normalized.strict) throw err;
      console.warn(
        '[gesture-audio/sprite-resolver] Failed to load sprite map — audio cues disabled',
        err,
      );
      _ready = true;
    }
  })();
  _initPromise = attempt;
  try {
    await attempt;
  } finally {
    if (_initPromise === attempt) _initPromise = null;
  }
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
  _activeSounds.set(id, { howl, bus: busTarget });
  const cleanup = (): void => {
    _activeSounds.delete(id);
    howl.off('end', cleanup, id);
    howl.off('stop', cleanup, id);
    howl.off('playerror', cleanup, id);
  };
  howl.once('end', cleanup, id);
  howl.once('stop', cleanup, id);
  howl.once('playerror', cleanup, id);
  return id;
}

/**
 * Stop a sound by Howler id.
 */
export function stopCue(id: number): void {
  if (id < 0) return;
  const active = _activeSounds.get(id);
  if (!active) return;
  active.howl.stop(id);
  _activeSounds.delete(id);
}

/**
 * Set volume for a named bus (0–1 linear).
 * Affects active sounds and subsequent playCue calls.
 *
 * The first bus name ever passed to setResolverVolume/setResolverMute is NOT
 * automatically treated as master — call `setResolverMasterBus(name)` once
 * (or rely on buses.ts naming its master bus 'master' by convention, which
 * setAndPersistBusVolume/applyPersistedAudioPrefs in preferences-bridge.ts do).
 */
export function setResolverVolume(bus: string, linear: number): void {
  if (bus.trim().length === 0) throw new Error('Bus name must not be empty');
  if (!Number.isFinite(linear)) throw new TypeError('linear must be a finite number');
  _busVolumes.set(bus, Math.max(0, Math.min(1, linear)));
  _refreshActiveSounds();
}

/**
 * Mute / unmute a named bus.
 */
export function setResolverMute(bus: string, muted: boolean): void {
  _setResolverMuteReason(bus, MANUAL_MUTE_REASON, muted);
}

/** @internal Apply an independently reversible mute layer. */
export function _setResolverMuteReason(bus: string, reason: string, muted: boolean): void {
  if (reason.length === 0) throw new Error('Mute reason must not be empty');
  const reasons = _muteReasons.get(bus) ?? new Set<string>();
  if (muted) reasons.add(reason);
  else reasons.delete(reason);
  if (reasons.size > 0) _muteReasons.set(bus, reasons);
  else _muteReasons.delete(bus);
  _refreshActiveSounds();
}

/**
 * Designate which bus name acts as the "master" override for the resolver
 * (mutes/scales all cue playback regardless of target bus). Optional — if
 * never called, only per-target-bus mute/volume applies.
 */
export function setResolverMasterBus(bus: string | null): void {
  if (bus !== null && bus.trim().length === 0) throw new Error('Master bus must not be empty');
  _masterBus = bus;
  _refreshActiveSounds();
}

function _refreshActiveSounds(): void {
  for (const [id, active] of _activeSounds) {
    active.howl.volume(_effectiveVolume(active.bus), id);
  }
}

/**
 * Dispose all Howl instances. Used in tests and hot-reload.
 */
export function disposeSpriteResolver(): void {
  for (const howl of _howls.values()) {
    howl.unload();
  }
  _howls.clear();
  _activeSounds.clear();
  _cueMap = {};
  _busVolumes.clear();
  _muteReasons.clear();
  _masterBus = null;
  _ready = false;
  _initPromise = null;
  _generation += 1;
}

/** Exposed for testing. */
export function _getCueMap(): SpriteMap {
  return Object.fromEntries(Object.entries(_cueMap).map(([cue, entry]) => [cue, { ...entry }]));
}

/** Exposed for testing/introspection. */
export function _getLastResolverOptions(): Required<SpriteResolverOptions> {
  return { ..._lastOptions, formats: [..._lastOptions.formats] };
}
