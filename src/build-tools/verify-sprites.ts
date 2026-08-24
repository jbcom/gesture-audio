/**
 * verify-sprites — generic audio-asset CI verifier, extracted from
 * on-the-ropes' src/build-tools/audio-verify/index.ts.
 *
 * Checks, given a `public/audio`-style directory and a manifest of expected
 * content:
 *   1. Every sprite bus directory exists with sprite.{webm,m4a,json}
 *      (or the formats the caller specifies)
 *   2. Every key in sprite.json resolves (start + duration within file length)
 *   3. No orphan audio files (files with no sprite.json entry)
 *   4. Each encoded file passes a LUFS check (integrated LUFS within
 *      tolerance of a target, via ffmpeg loudnorm)
 *   5. Total directory size stays under a byte budget
 *   6. Arbitrary flat "one file per key" content (crowd-bed states, music
 *      tracks, or any other <dir>/<key>.<ext> convention)
 *
 * This module exports a programmatic `verifySprites()` function plus a CLI
 * entry point (`runVerifySpritesCli()`) a game's own `audio:verify` script
 * can call with its own bus/content manifest — no game-specific names are
 * baked in here.
 *
 * Requires `ffprobe`/`ffmpeg` on PATH for duration + LUFS checks (skippable
 * via `fast: true`, which matches the source's `--fast` CI flag).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';

export interface FlatContentGroup {
  /** Sub-directory under the audio root, e.g. 'crowd-bed' or 'music'. */
  dir: string;
  /** Expected file-stem keys, e.g. ['silent','murmur',...] or ['lofi-calm',...]. */
  keys: string[];
  /** File extensions each key must have (default: same as `formats` option). */
  formats?: string[];
  /** Whether missing files are a hard failure (default false — warn only). */
  required?: boolean;
}

export interface VerifySpritesOptions {
  /** Root directory containing the built audio assets (e.g. 'public/audio'). */
  audioRoot: string;
  /** Sprite-bus sub-directories to verify (each must have sprite.<ext> + sprite.json). */
  spriteBuses: string[];
  /** File extensions to check per sprite bus (default: ['webm', 'm4a']). */
  formats?: string[];
  /** Flat "one file per key" content groups (crowd-bed states, music tracks, etc). */
  flatGroups?: FlatContentGroup[];
  /** Skip LUFS measurement (faster, no ffmpeg dependency at runtime). */
  fast?: boolean;
  /** Target integrated LUFS for the loudness check (default -14, streaming-loudness convention). */
  lufsTarget?: number;
  /** Allowed +/- deviation from lufsTarget before it's a failure (default 3). */
  lufsTolerance?: number;
  /** Maximum total bytes for audioRoot (default: no limit). */
  maxTotalBytes?: number;
}

export interface VerifyResult {
  failures: number;
  warnings: number;
  lines: string[];
}

function fail(result: VerifyResult, msg: string): void {
  result.lines.push(`  ✗ FAIL  ${msg}`);
  result.failures++;
}

function warn(result: VerifyResult, msg: string): void {
  result.lines.push(`  ⚠ WARN  ${msg}`);
  result.warnings++;
}

function pass(result: VerifyResult, msg: string): void {
  result.lines.push(`  ✓       ${msg}`);
}

interface FfprobeStream {
  codec_type?: string;
  duration?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
}

function getAudioDurationSec(filePath: string): number | null {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_streams', filePath],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) return null;
  try {
    const data = JSON.parse(result.stdout) as FfprobeOutput;
    const audio = data.streams?.find((s) => s.codec_type === 'audio');
    return audio?.duration ? Number.parseFloat(audio.duration) : null;
  } catch {
    return null;
  }
}

function measureLufs(filePath: string): number | null {
  const result = spawnSync(
    'ffmpeg',
    ['-i', filePath, '-af', 'loudnorm=print_format=summary', '-f', 'null', '-'],
    { encoding: 'utf8' },
  );
  const match = result.stderr?.match(/Input Integrated:\s*([-\d.]+)\s*LUFS/);
  return match?.[1] ? Number.parseFloat(match[1]) : null;
}

function dirSizeBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  const pending = [dir];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) {
        try {
          total += lstatSync(path).size;
        } catch {
          // The file vanished between directory scan and stat.
        }
      }
    }
  }
  return total;
}

function validateRelativePath(value: string, label: string): void {
  const normalized = normalize(value);
  if (
    value.trim().length === 0 ||
    isAbsolute(value) ||
    normalized === '..' ||
    normalized.startsWith(`..${sep}`)
  ) {
    throw new TypeError(`${label} must be a non-empty path inside audioRoot`);
  }
}

function validateOptions(opts: VerifySpritesOptions): void {
  if (opts.audioRoot.trim().length === 0) throw new TypeError('audioRoot must not be empty');
  const formats = opts.formats ?? ['webm', 'm4a'];
  if (formats.length === 0 || formats.some((format) => !/^[a-z0-9]+$/i.test(format))) {
    throw new TypeError(
      'formats must contain at least one extension using only letters and digits',
    );
  }
  for (const bus of opts.spriteBuses) validateRelativePath(bus, 'sprite bus');
  for (const group of opts.flatGroups ?? []) {
    validateRelativePath(group.dir, 'flat group dir');
    const groupFormats = group.formats ?? formats;
    if (groupFormats.length === 0 || groupFormats.some((format) => !/^[a-z0-9]+$/i.test(format))) {
      throw new TypeError(`formats for flat group "${group.dir}" must use only letters and digits`);
    }
    for (const key of group.keys) validateRelativePath(key, `key in flat group "${group.dir}"`);
  }
  for (const [value, label] of [
    [opts.lufsTarget, 'lufsTarget'],
    [opts.lufsTolerance, 'lufsTolerance'],
    [opts.maxTotalBytes, 'maxTotalBytes'],
  ] as const) {
    if (value !== undefined && !Number.isFinite(value)) {
      throw new TypeError(`${label} must be a finite number`);
    }
  }
  if (opts.lufsTolerance !== undefined && opts.lufsTolerance < 0) {
    throw new RangeError('lufsTolerance must be greater than or equal to 0');
  }
  if (opts.maxTotalBytes !== undefined && opts.maxTotalBytes < 0) {
    throw new RangeError('maxTotalBytes must be greater than or equal to 0');
  }
}

/**
 * Run the full verification suite and return a structured result
 * (never calls process.exit — safe to call from tests or other tooling).
 */
export async function verifySprites(opts: VerifySpritesOptions): Promise<VerifyResult> {
  validateOptions(opts);
  const {
    audioRoot,
    spriteBuses,
    formats = ['webm', 'm4a'],
    flatGroups = [],
    fast = false,
    lufsTarget = -14,
    lufsTolerance = 3,
    maxTotalBytes,
  } = opts;

  const result: VerifyResult = { failures: 0, warnings: 0, lines: [] };

  if (!existsSync(audioRoot)) {
    fail(result, `Audio root missing: ${resolve(audioRoot)}`);
    result.lines.push(`\n── Summary: ${result.failures} failure(s), ${result.warnings} warning(s)`);
    return result;
  }

  // Sprite buses
  result.lines.push('\n── Sprite buses');
  for (const bus of spriteBuses) {
    const busDir = join(audioRoot, bus);
    if (!existsSync(busDir)) {
      fail(result, `Bus dir missing: ${bus}/`);
      continue;
    }

    const filesByExt = Object.fromEntries(
      formats.map((ext) => [ext, join(busDir, `sprite.${ext}`)]),
    );
    const jsonPath = join(busDir, 'sprite.json');

    for (const [ext, path] of Object.entries(filesByExt)) {
      if (!existsSync(path)) fail(result, `${bus}/sprite.${ext} missing`);
    }
    if (!existsSync(jsonPath)) {
      fail(result, `${bus}/sprite.json missing`);
      continue;
    }

    let spriteJson: { src?: unknown; sprite?: Record<string, unknown> };
    try {
      spriteJson = JSON.parse(await readFile(jsonPath, 'utf8'));
    } catch {
      fail(result, `${bus}/sprite.json: invalid JSON`);
      continue;
    }

    if (!Array.isArray(spriteJson.src)) fail(result, `${bus}/sprite.json: missing .src array`);
    if (!spriteJson.sprite || typeof spriteJson.sprite !== 'object') {
      fail(result, `${bus}/sprite.json: missing .sprite map`);
      continue;
    }

    const keys = Object.keys(spriteJson.sprite);
    if (keys.length === 0) {
      warn(result, `${bus}/sprite.json: empty sprite map`);
      continue;
    }

    const refExt = formats.find((ext) => existsSync(filesByExt[ext] ?? ''));
    const refFile = refExt ? filesByExt[refExt] : undefined;
    const totalDurationSec = refFile ? getAudioDurationSec(refFile) : null;
    const totalDurationMs = totalDurationSec != null ? totalDurationSec * 1000 : null;

    for (const [key, entry] of Object.entries(spriteJson.sprite)) {
      if (!Array.isArray(entry) || entry.length < 2) {
        fail(result, `${bus}/${key}: sprite entry must be [startMs, durationMs]`);
        continue;
      }
      const [startMs, durationMs] = entry as unknown[];
      if (
        typeof startMs !== 'number' ||
        typeof durationMs !== 'number' ||
        !Number.isFinite(startMs) ||
        !Number.isFinite(durationMs) ||
        startMs < 0 ||
        durationMs <= 0
      ) {
        fail(result, `${bus}/${key}: invalid offset/duration [${startMs}, ${durationMs}]`);
        continue;
      }
      if (totalDurationMs != null && startMs + durationMs > totalDurationMs + 50) {
        fail(
          result,
          `${bus}/${key}: end (${startMs + durationMs}ms) exceeds file length (${Math.round(totalDurationMs)}ms)`,
        );
      }
    }

    const audioFiles = readdirSync(busDir).filter((file) =>
      formats.some((ext) => file.endsWith(`.${ext}`)),
    );
    const expectedAudio = new Set(formats.map((ext) => `sprite.${ext}`));
    for (const f of audioFiles) {
      if (!expectedAudio.has(f)) warn(result, `${bus}/${f}: orphan audio file`);
    }

    pass(result, `${bus}: ${keys.length} clips, files present`);

    if (!fast && refFile && existsSync(refFile)) {
      const lufs = measureLufs(refFile);
      if (lufs == null) {
        warn(result, `${bus}: could not measure LUFS`);
      } else if (Math.abs(lufs - lufsTarget) > lufsTolerance) {
        fail(
          result,
          `${bus}: LUFS ${lufs.toFixed(1)} outside target ${lufsTarget} ± ${lufsTolerance}`,
        );
      } else {
        pass(result, `${bus}: LUFS ${lufs.toFixed(1)}`);
      }
    }
  }

  // Flat content groups (crowd-bed states, music tracks, etc.)
  for (const group of flatGroups) {
    result.lines.push(`\n── ${group.dir}`);
    const groupDir = join(audioRoot, group.dir);
    const groupFormats = group.formats ?? formats;
    for (const key of group.keys) {
      const paths = groupFormats.map((ext) => join(groupDir, `${key}.${ext}`));
      const allPresent = paths.every((p) => existsSync(p));
      if (!allPresent) {
        const msg = `${group.dir}/${key}: missing`;
        if (group.required) fail(result, msg);
        else warn(result, msg);
        continue;
      }
      pass(result, `${group.dir}/${key}`);
      if (!fast) {
        const ref = paths[0];
        if (ref) {
          const lufs = measureLufs(ref);
          if (lufs == null) {
            warn(result, `${group.dir}/${key}: could not measure LUFS`);
          } else if (Math.abs(lufs - lufsTarget) > lufsTolerance) {
            fail(result, `${group.dir}/${key}: LUFS ${lufs.toFixed(1)} outside target`);
          }
        }
      }
    }
  }

  // Budget
  if (maxTotalBytes != null) {
    result.lines.push('\n── Budget');
    const totalBytes = dirSizeBytes(audioRoot);
    const totalMB = (totalBytes / 1024 / 1024).toFixed(2);
    const maxMB = (maxTotalBytes / 1024 / 1024).toFixed(0);
    if (totalBytes > maxTotalBytes) {
      fail(result, `Total ${audioRoot} size ${totalMB}MB exceeds ${maxMB}MB budget`);
    } else {
      pass(result, `Total ${audioRoot} size: ${totalMB}MB / ${maxMB}MB`);
    }
  }

  result.lines.push(`\n── Summary: ${result.failures} failure(s), ${result.warnings} warning(s)`);
  return result;
}

/**
 * CLI entry point. Prints `result.lines` and calls `process.exit(1)` on
 * any failure — intended for a game's own `tsx` build-tools script that
 * supplies its own manifest, e.g.:
 *
 *   import { runVerifySpritesCli } from '@jbdevprimary/gesture-audio/build-tools';
 *   await runVerifySpritesCli({
 *     audioRoot: 'public/audio',
 *     spriteBuses: ['ui', 'impact', 'whoosh'],
 *     flatGroups: [{ dir: 'crowd-bed', keys: ['silent','murmur','invested','pop','riot'] }],
 *     maxTotalBytes: 12 * 1024 * 1024,
 *     fast: process.argv.includes('--fast'),
 *   });
 */
export async function runVerifySpritesCli(opts: VerifySpritesOptions): Promise<void> {
  const result = await verifySprites(opts);
  for (const line of result.lines) console.log(line);
  if (result.failures > 0) {
    console.error('\nAudio asset verification FAILED.');
    process.exit(1);
  }
  console.log('\nAudio asset verification passed.');
}
