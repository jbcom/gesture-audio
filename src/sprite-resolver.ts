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

import { Howl, Howler } from 'howler';

/** Three-dimensional coordinates used by Howler's public spatial APIs. */
export type AudioPosition = readonly [number, number, number];

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
  /** Encoded extensions available for this file, in Howler preference order. */
  formats?: readonly string[];
  /** Whether this individual sprite repeats until `stopCue` is called. */
  loop?: boolean;
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

/** Per-playback routing and spatial options for `playCue`. */
export interface PlayCueOptions {
  /** Target bus name. Defaults to `sfx`. */
  bus?: string;
  /** Logical cue gain, composed with the live master and bus gains. Defaults to `1`. */
  gain?: number;
  /** Optional Howler spatial position for this playback. */
  position?: AudioPosition;
}

const DEFAULT_SPRITE_MAP_URL = '/audio/sprite-map.json';
const DEFAULT_FORMATS = ['webm', 'm4a'];
const DEFAULT_AUDIO_BASE_URL = '/audio';

/**
 * Active Howl instances keyed by sprite-file path.
 * One Howl per sprite sheet (shared across all cues in that sheet).
 */
const _howls = new Map<string, Howl>();
interface FadeState {
  from: number;
  to: number;
  durationMs: number;
  elapsedMs: number;
  startedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

interface ActiveSound {
  howl: Howl;
  bus: string;
  gain: number;
  loop: boolean;
  paused: boolean;
  fade: FadeState | null;
  cleanup: (() => void) | null;
}

const _activeSounds = new Map<number, ActiveSound>();

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

function _effectiveVolume(busTarget: string, cueGain = 1): number {
  if (_masterBus && (_muteReasons.get(_masterBus)?.size ?? 0) > 0) return 0;
  if ((_muteReasons.get(busTarget)?.size ?? 0) > 0) return 0;
  const masterVol = _masterBus ? (_busVolumes.get(_masterBus) ?? 1) : 1;
  const busVol = _busVolumes.get(busTarget) ?? 1;
  return masterVol * busVol * cueGain;
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`);
}

function normalizeGain(value: number, label: string): number {
  assertFinite(value, label);
  return Math.max(0, Math.min(1, value));
}

function assertPosition(position: AudioPosition, label: string): void {
  if (!Array.isArray(position) || position.length !== 3) {
    throw new TypeError(`${label} must be a three-number tuple`);
  }
  for (const coordinate of position) assertFinite(coordinate, label);
}

function normalizeFormats(formats: readonly string[], label: string): string[] {
  if (
    formats.length === 0 ||
    formats.some((format) => typeof format !== 'string' || !/^[a-z0-9]+$/i.test(format))
  ) {
    throw new TypeError(`${label} must contain extensions using only letters and digits`);
  }
  if (new Set(formats).size !== formats.length) {
    throw new TypeError(`${label} must not contain duplicate extensions`);
  }
  return [...formats];
}

function isSafeSpriteFile(value: string): boolean {
  // Sprite maps are fetched at runtime. Keep a map entry confined to the
  // configured audio base rather than allowing it to walk to an unrelated
  // same-origin endpoint via `../` segments.
  const relative = value.replace(/^\/+/, '');
  return (
    value.trim().length > 0 &&
    relative.length > 0 &&
    !value.includes('\\') &&
    relative
      .split('/')
      .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  );
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
    isSafeSpriteFile(entry.file) &&
    (entry.formats === undefined ||
      (Array.isArray(entry.formats) &&
        (() => {
          try {
            normalizeFormats(entry.formats, 'formats');
            return true;
          } catch {
            return false;
          }
        })())) &&
    (entry.loop === undefined || typeof entry.loop === 'boolean')
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
  const flat = Object.create(null) as SpriteMap;
  const warnings: string[] = [];
  const topLevelEntries = Object.entries(obj);
  const flatShape = topLevelEntries.some(([, value]) => isSpriteEntry(value));

  const addEntry = (cue: string, value: unknown, context: string): void => {
    if (cue.trim().length === 0 || !isSpriteEntry(value)) {
      warnings.push(`${context}: invalid cue entry`);
      return;
    }
    if (Object.hasOwn(flat, cue)) {
      warnings.push(`${context}: duplicate cue name "${cue}"`);
      return;
    }
    flat[cue] = {
      ...value,
      ...(value.formats ? { formats: [...value.formats] } : {}),
    };
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

function _validateFileFormats(
  map: SpriteMap,
  fallbackFormats: readonly string[],
): { map: SpriteMap; formatsByFile: Map<string, string[]>; warnings: string[] } {
  const filtered = Object.create(null) as SpriteMap;
  const formatsByFile = new Map<string, string[]>();
  const warnings: string[] = [];
  for (const [cue, entry] of Object.entries(map)) {
    const formats = entry.formats
      ? normalizeFormats(entry.formats, `${cue}.formats`)
      : [...fallbackFormats];
    const established = formatsByFile.get(entry.file);
    if (
      established &&
      (established.length !== formats.length ||
        established.some((format, index) => format !== formats[index]))
    ) {
      warnings.push(`${cue}: formats for "${entry.file}" must match every other cue in that file`);
      continue;
    }
    if (!established) formatsByFile.set(entry.file, formats);
    filtered[cue] = entry;
  }
  return { map: filtered, formatsByFile, warnings };
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
  const spriteObj: Record<string, [number, number] | [number, number, boolean]> = {};
  for (const [cue, entry] of entries) {
    spriteObj[cue] = entry.loop
      ? [entry.start_ms, entry.end_ms - entry.start_ms, true]
      : [entry.start_ms, entry.end_ms - entry.start_ms];
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
  const formats = normalizeFormats(opts.formats ?? DEFAULT_FORMATS, 'formats');
  const spriteMapUrl = opts.spriteMapUrl ?? DEFAULT_SPRITE_MAP_URL;
  const audioBaseUrl = opts.audioBaseUrl ?? DEFAULT_AUDIO_BASE_URL;
  if (spriteMapUrl.trim().length === 0) throw new TypeError('spriteMapUrl must not be empty');
  if (audioBaseUrl.trim().length === 0) throw new TypeError('audioBaseUrl must not be empty');
  return { spriteMapUrl, formats, audioBaseUrl, strict: opts.strict ?? false };
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
      const validated = _validateFileFormats(parsed.map, normalized.formats);
      const warnings = [...parsed.warnings, ...validated.warnings];
      if (warnings.length > 0) {
        const message = `Invalid sprite map: ${warnings.join('; ')}`;
        if (normalized.strict) throw new Error(message);
        console.warn(`[gesture-audio/sprite-resolver] ${message}`);
      }
      // Group entries by file and build one Howl per file
      const byFile = new Map<string, Array<[string, SpriteEntry]>>();
      for (const [cue, entry] of Object.entries(validated.map)) {
        const list = byFile.get(entry.file) ?? [];
        list.push([cue, entry]);
        byFile.set(entry.file, list);
      }
      for (const [file, entries] of byFile) {
        createdHowls.set(
          file,
          _buildHowlForFile(
            file,
            entries,
            validated.formatsByFile.get(file) ?? normalized.formats,
            normalized.audioBaseUrl,
          ),
        );
      }
      if (generation !== _generation) {
        for (const howl of createdHowls.values()) howl.unload();
        return;
      }
      _cueMap = validated.map;
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
export function playCue(cueName: string, busTarget?: string): number;
export function playCue(cueName: string, options?: PlayCueOptions): number;
export function playCue(cueName: string, target: string | PlayCueOptions = 'sfx'): number {
  if (!_ready) {
    console.warn(
      '[gesture-audio/sprite-resolver] resolver not initialised; call initSpriteResolver() first',
    );
    return -1;
  }

  const options: PlayCueOptions = typeof target === 'string' ? { bus: target } : target;
  const bus = options.bus ?? 'sfx';
  if (bus.trim().length === 0) throw new Error('Bus name must not be empty');
  const gain = normalizeGain(options.gain ?? 1, 'gain');
  if (options.position) assertPosition(options.position, 'position');

  const entry = _cueMap[cueName];
  if (!entry) {
    // Silent no-op for missing cues — content may not have landed all cues yet
    return -1;
  }

  const howl = _howls.get(entry.file);
  if (!howl) return -1;

  const id = howl.play(cueName);
  const active: ActiveSound = {
    howl,
    bus,
    gain,
    loop: entry.loop === true,
    paused: false,
    fade: null,
    cleanup: null,
  };
  const cleanup = (): void => {
    const current = _activeSounds.get(id);
    if (current !== active) return;
    _clearFade(current);
    _activeSounds.delete(id);
    howl.off('end', endHandler, id);
    howl.off('stop', cleanup, id);
    howl.off('playerror', cleanup, id);
  };
  const endHandler = (): void => {
    if (active.loop) {
      _refreshActiveSound(id, active);
      return;
    }
    cleanup();
  };
  active.cleanup = cleanup;
  _activeSounds.set(id, active);
  howl.volume(_effectiveVolume(bus, gain), id);
  if (options.position) howl.pos(...options.position, id);
  howl.on('end', endHandler, id);
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
  active.cleanup?.();
}

/** Set a cue's own logical gain without overwriting live master or bus state. */
export function setCueGain(id: number, gain: number): boolean {
  const active = _activeSounds.get(id);
  if (!active) return false;
  _clearFade(active);
  active.gain = normalizeGain(gain, 'gain');
  _refreshActiveSound(id, active);
  return true;
}

/** Pause an active cue, including any logical fade until it is resumed. */
export function pauseCue(id: number): boolean {
  const active = _activeSounds.get(id);
  if (!active || active.paused) return false;
  _freezeFade(active);
  active.howl.pause(id);
  active.paused = true;
  return true;
}

/** Resume an active cue using its original Howler ID. Returns -1 when unavailable. */
export function resumeCue(id: number): number {
  const active = _activeSounds.get(id);
  if (!active?.paused) return -1;
  active.howl.play(id);
  active.paused = false;
  _resumeFade(id, active);
  return id;
}

/** Fade a cue's logical gain while continuing to compose current bus/mute layers. */
export function fadeCue(id: number, toGain: number, durationMs: number): boolean {
  const active = _activeSounds.get(id);
  if (!active) return false;
  const to = normalizeGain(toGain, 'toGain');
  assertFinite(durationMs, 'durationMs');
  if (durationMs < 0) throw new RangeError('durationMs must be greater than or equal to 0');
  _clearFade(active);
  if (durationMs === 0) {
    active.gain = to;
    _refreshActiveSound(id, active);
    return true;
  }
  active.fade = {
    from: active.gain,
    to,
    durationMs,
    elapsedMs: 0,
    startedAt: Date.now(),
    timer: null,
  };
  if (!active.paused) _scheduleFade(id, active);
  return true;
}

/** Set an active cue's spatial position through Howler's public API. */
export function setCuePosition(id: number, position: AudioPosition): boolean {
  assertPosition(position, 'position');
  const active = _activeSounds.get(id);
  if (!active) return false;
  active.howl.pos(...position, id);
  return true;
}

/** Set Howler's global listener position and orientation through its public API. */
export function setAudioListener(
  position: AudioPosition,
  forward: AudioPosition,
  up: AudioPosition = [0, 1, 0],
): void {
  assertPosition(position, 'position');
  assertPosition(forward, 'forward');
  assertPosition(up, 'up');
  Howler.pos(...position);
  Howler.orientation(...forward, ...up);
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
    _refreshActiveSound(id, active);
  }
}

function _refreshActiveSound(id: number, active: ActiveSound): void {
  active.howl.volume(_effectiveVolume(active.bus, active.gain), id);
}

function _clearFade(active: ActiveSound): void {
  if (active.fade?.timer) clearTimeout(active.fade.timer);
  active.fade = null;
}

function _advanceFade(id: number, active: ActiveSound): boolean {
  const fade = active.fade;
  if (!fade || active.paused) return false;
  const now = Date.now();
  fade.elapsedMs = Math.min(fade.durationMs, fade.elapsedMs + (now - fade.startedAt));
  fade.startedAt = now;
  active.gain = fade.from + (fade.to - fade.from) * (fade.elapsedMs / fade.durationMs);
  _refreshActiveSound(id, active);
  if (fade.elapsedMs >= fade.durationMs) {
    active.gain = fade.to;
    active.fade = null;
    return false;
  }
  return true;
}

function _scheduleFade(id: number, active: ActiveSound): void {
  if (!_advanceFade(id, active)) return;
  const fade = active.fade;
  if (!fade) return;
  fade.timer = setTimeout(
    () => _scheduleFade(id, active),
    Math.min(16, fade.durationMs - fade.elapsedMs),
  );
}

function _freezeFade(active: ActiveSound): void {
  const fade = active.fade;
  if (!fade) return;
  if (fade.timer) clearTimeout(fade.timer);
  fade.timer = null;
  if (!active.paused) {
    const now = Date.now();
    fade.elapsedMs = Math.min(fade.durationMs, fade.elapsedMs + (now - fade.startedAt));
    fade.startedAt = now;
    active.gain = fade.from + (fade.to - fade.from) * (fade.elapsedMs / fade.durationMs);
  }
}

function _resumeFade(id: number, active: ActiveSound): void {
  if (!active.fade) return;
  active.fade.startedAt = Date.now();
  _scheduleFade(id, active);
}

/**
 * Dispose all Howl instances. Used in tests and hot-reload.
 */
export function disposeSpriteResolver(): void {
  for (const active of _activeSounds.values()) active.cleanup?.();
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
