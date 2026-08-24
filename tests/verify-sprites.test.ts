/**
 * Tests: src/build-tools/verify-sprites.ts
 *
 * Runs the verifier against real, tiny generated audio fixtures (via ffmpeg/
 * ffprobe on PATH) rather than mocking spawnSync — this is a build-time CI
 * tool, so exercising the real subprocess calls is the meaningful test.
 * Falls back to skipping LUFS/duration-dependent cases if ffmpeg/ffprobe are
 * unavailable in the environment running the suite.
 *
 * Known coverage gap: the JSON.parse catch inside the module-private
 * getAudioDurationSec() (malformed-but-exit-0 ffprobe stdout) could not be
 * exercised. `vi.mock('node:child_process', ...)`, `vi.doMock`, and
 * `vi.spyOn` on the imported namespace were all tried; in this Vitest 4 +
 * jsdom setup none of them intercept the `spawnSync` binding that
 * verify-sprites.ts closes over for a Node builtin imported via the `node:`
 * specifier (`vi.spyOn` fails outright with "Module namespace is not
 * configurable in ESM"; the vi.mock/vi.doMock factories register but the
 * module under test keeps calling the real spawnSync). A real ffprobe never
 * emits non-JSON stdout on exit 0, so the branch is a pure defensive guard
 * with no reachable failure mode via the public API.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { runVerifySpritesCli, verifySprites } from '../src/build-tools/verify-sprites';

const HAS_FFMPEG = spawnSync('ffmpeg', ['-version']).status === 0;
const HAS_FFPROBE = spawnSync('ffprobe', ['-version']).status === 0;
const HAS_FFTOOLS = HAS_FFMPEG && HAS_FFPROBE;

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gesture-audio-verify-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * Generate a short real audio file at `path` using ffmpeg, picking a codec
 * that matches the container implied by the extension (opus for .webm, AAC
 * for .m4a — ffmpeg's default muxer selection cannot hold opus in an m4a/ipod
 * container).
 */
function generateAudio(path: string, durationSec: number, freq = 440): void {
  const codec = path.endsWith('.m4a') ? 'aac' : 'libopus';
  const result = spawnSync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${freq}:duration=${durationSec}`,
    '-c:a',
    codec,
    path,
  ]);
  if (result.status !== 0) {
    throw new Error(`ffmpeg fixture generation failed: ${result.stderr?.toString()}`);
  }
}

describe.skipIf(!HAS_FFTOOLS)('verifySprites — sprite buses (real audio fixtures)', () => {
  afterEach(() => {
    rmSync(join(root, 'passing-bus'), { recursive: true, force: true });
    rmSync(join(root, 'orphan-bus'), { recursive: true, force: true });
    rmSync(join(root, 'bad-range-bus'), { recursive: true, force: true });
  });

  it('passes a well-formed sprite bus with valid offsets', async () => {
    const busDir = join(root, 'passing-bus');
    mkdirSync(busDir, { recursive: true });
    generateAudio(join(busDir, 'sprite.webm'), 1);
    generateAudio(join(busDir, 'sprite.m4a'), 1);
    writeFileSync(
      join(busDir, 'sprite.json'),
      JSON.stringify({
        src: [`sprite.webm`, `sprite.m4a`],
        sprite: { click: [0, 300], hover: [300, 200] },
      }),
    );

    const result = await verifySprites({
      audioRoot: root,
      spriteBuses: ['passing-bus'],
      fast: true,
    });

    expect(result.failures).toBe(0);
    expect(result.lines.some((l) => l.includes('passing-bus: 2 clips, files present'))).toBe(true);
  });

  it('flags an orphan audio file with no sprite.json entry', async () => {
    const busDir = join(root, 'orphan-bus');
    mkdirSync(busDir, { recursive: true });
    generateAudio(join(busDir, 'sprite.webm'), 1);
    generateAudio(join(busDir, 'sprite.m4a'), 1);
    writeFileSync(join(busDir, 'extra.webm'), 'not-real-audio-but-present');
    writeFileSync(
      join(busDir, 'sprite.json'),
      JSON.stringify({ src: ['sprite.webm'], sprite: { click: [0, 300] } }),
    );

    const result = await verifySprites({
      audioRoot: root,
      spriteBuses: ['orphan-bus'],
      fast: true,
    });

    expect(result.warnings).toBeGreaterThan(0);
    expect(result.lines.some((l) => l.includes('orphan audio file'))).toBe(true);
  });

  it('fails when a sprite entry offset exceeds the file length', async () => {
    const busDir = join(root, 'bad-range-bus');
    mkdirSync(busDir, { recursive: true });
    generateAudio(join(busDir, 'sprite.webm'), 1);
    generateAudio(join(busDir, 'sprite.m4a'), 1);
    writeFileSync(
      join(busDir, 'sprite.json'),
      JSON.stringify({
        src: ['sprite.webm'],
        // 1s file (~1000ms); this entry claims to run to 5000ms.
        sprite: { tooLong: [0, 5000] },
      }),
    );

    // This ffprobe build reports per-stream `duration` for AAC/m4a but not
    // for Opus/webm (only a DURATION tag), so pin the format probe order to
    // m4a to exercise the real duration-vs-offset comparison deterministically.
    const result = await verifySprites({
      audioRoot: root,
      spriteBuses: ['bad-range-bus'],
      formats: ['m4a', 'webm'],
      fast: true,
    });

    expect(result.failures).toBeGreaterThan(0);
    expect(result.lines.some((l) => l.includes('exceeds file length'))).toBe(true);
  });

  it('warns when LUFS cannot be measured from a corrupt/non-audio reference file', async () => {
    const busDir = join(root, 'passing-bus');
    mkdirSync(busDir, { recursive: true });
    // Real, valid audio for the .webm file the presence checks require, but
    // the .m4a "reference" file used by getAudioDurationSec/measureLufs is
    // corrupt, so ffprobe/ffmpeg both fail to parse it.
    generateAudio(join(busDir, 'sprite.webm'), 1);
    writeFileSync(join(busDir, 'sprite.m4a'), 'not a real audio container');
    writeFileSync(
      join(busDir, 'sprite.json'),
      JSON.stringify({ src: ['sprite.m4a'], sprite: { click: [0, 300] } }),
    );

    const result = await verifySprites({
      audioRoot: root,
      spriteBuses: ['passing-bus'],
      formats: ['m4a', 'webm'],
      fast: false,
    });

    expect(result.lines.some((l) => l.includes('could not measure LUFS'))).toBe(true);
  });

  it('measures LUFS and passes when within tolerance of the target (non-fast mode)', async () => {
    const busDir = join(root, 'passing-bus');
    mkdirSync(busDir, { recursive: true });
    generateAudio(join(busDir, 'sprite.webm'), 1);
    generateAudio(join(busDir, 'sprite.m4a'), 1);
    writeFileSync(
      join(busDir, 'sprite.json'),
      JSON.stringify({ src: ['sprite.webm'], sprite: { click: [0, 300] } }),
    );

    // A generated sine tone lands well outside typical streaming-loudness
    // targets, so target/tolerance are set wide enough to exercise the LUFS
    // "pass" branch deterministically without pinning to ffmpeg's exact output.
    const result = await verifySprites({
      audioRoot: root,
      spriteBuses: ['passing-bus'],
      fast: false,
      lufsTarget: -20,
      lufsTolerance: 50,
    });

    expect(result.lines.some((l) => l.includes('LUFS'))).toBe(true);
    expect(result.failures).toBe(0);
  });

  it('fails when measured LUFS falls outside the tight tolerance window', async () => {
    const busDir = join(root, 'passing-bus');
    mkdirSync(busDir, { recursive: true });
    generateAudio(join(busDir, 'sprite.webm'), 1);
    generateAudio(join(busDir, 'sprite.m4a'), 1);
    writeFileSync(
      join(busDir, 'sprite.json'),
      JSON.stringify({ src: ['sprite.webm'], sprite: { click: [0, 300] } }),
    );

    const result = await verifySprites({
      audioRoot: root,
      spriteBuses: ['passing-bus'],
      fast: false,
      lufsTarget: -90,
      lufsTolerance: 0.01,
    });

    expect(result.failures).toBeGreaterThan(0);
    expect(result.lines.some((l) => l.includes('LUFS') && l.includes('outside target'))).toBe(true);
  });
});

describe('verifySprites — structural checks (no audio decode required)', () => {
  afterEach(() => {
    rmSync(join(root, 'missing-bus-dir'), { recursive: true, force: true });
    rmSync(join(root, 'missing-files-bus'), { recursive: true, force: true });
    rmSync(join(root, 'bad-json-bus'), { recursive: true, force: true });
    rmSync(join(root, 'missing-src-bus'), { recursive: true, force: true });
    rmSync(join(root, 'missing-sprite-map-bus'), { recursive: true, force: true });
    rmSync(join(root, 'empty-sprite-bus'), { recursive: true, force: true });
    rmSync(join(root, 'invalid-entry-bus'), { recursive: true, force: true });
    rmSync(join(root, 'negative-offset-bus'), { recursive: true, force: true });
    rmSync(join(root, 'crowd-bed'), { recursive: true, force: true });
    rmSync(join(root, 'crowd-bed-required'), { recursive: true, force: true });
    rmSync(join(root, 'budget-bus'), { recursive: true, force: true });
  });

  it('warns (not fails) when a sprite bus directory does not exist', async () => {
    const result = await verifySprites({
      audioRoot: root,
      spriteBuses: ['missing-bus-dir'],
      fast: true,
    });
    expect(result.failures).toBe(0);
    expect(result.warnings).toBeGreaterThan(0);
    expect(result.lines.some((l) => l.includes('Bus dir missing: missing-bus-dir/'))).toBe(true);
  });

  it('fails when sprite audio files are missing but the directory exists', async () => {
    const busDir = join(root, 'missing-files-bus');
    mkdirSync(busDir, { recursive: true });
    writeFileSync(
      join(busDir, 'sprite.json'),
      JSON.stringify({ src: ['sprite.webm'], sprite: { click: [0, 300] } }),
    );

    const result = await verifySprites({
      audioRoot: root,
      spriteBuses: ['missing-files-bus'],
      fast: true,
    });

    expect(result.failures).toBeGreaterThan(0);
    expect(result.lines.some((l) => l.includes('sprite.webm missing'))).toBe(true);
    expect(result.lines.some((l) => l.includes('sprite.m4a missing'))).toBe(true);
  });

  it('fails when sprite.json is missing entirely', async () => {
    const busDir = join(root, 'missing-files-bus');
    mkdirSync(busDir, { recursive: true });
    // No sprite.json at all.

    const result = await verifySprites({
      audioRoot: root,
      spriteBuses: ['missing-files-bus'],
      fast: true,
    });

    expect(result.failures).toBeGreaterThan(0);
    expect(result.lines.some((l) => l.includes('sprite.json missing'))).toBe(true);
  });

  it('fails when sprite.json contains invalid JSON', async () => {
    const busDir = join(root, 'bad-json-bus');
    mkdirSync(busDir, { recursive: true });
    writeFileSync(join(busDir, 'sprite.json'), '{ not valid json ');

    const result = await verifySprites({
      audioRoot: root,
      spriteBuses: ['bad-json-bus'],
      fast: true,
    });

    expect(result.failures).toBeGreaterThan(0);
    expect(result.lines.some((l) => l.includes('invalid JSON'))).toBe(true);
  });

  it('fails when sprite.json is missing the .src array', async () => {
    const busDir = join(root, 'missing-src-bus');
    mkdirSync(busDir, { recursive: true });
    writeFileSync(join(busDir, 'sprite.json'), JSON.stringify({ sprite: { click: [0, 300] } }));

    const result = await verifySprites({
      audioRoot: root,
      spriteBuses: ['missing-src-bus'],
      fast: true,
    });

    expect(result.failures).toBeGreaterThan(0);
    expect(result.lines.some((l) => l.includes('missing .src array'))).toBe(true);
  });

  it('fails when sprite.json is missing the .sprite map', async () => {
    const busDir = join(root, 'missing-sprite-map-bus');
    mkdirSync(busDir, { recursive: true });
    writeFileSync(join(busDir, 'sprite.json'), JSON.stringify({ src: ['sprite.webm'] }));

    const result = await verifySprites({
      audioRoot: root,
      spriteBuses: ['missing-sprite-map-bus'],
      fast: true,
    });

    expect(result.failures).toBeGreaterThan(0);
    expect(result.lines.some((l) => l.includes('missing .sprite map'))).toBe(true);
  });

  it('warns when the sprite map is present but empty', async () => {
    const busDir = join(root, 'empty-sprite-bus');
    mkdirSync(busDir, { recursive: true });
    writeFileSync(
      join(busDir, 'sprite.json'),
      JSON.stringify({ src: ['sprite.webm'], sprite: {} }),
    );

    const result = await verifySprites({
      audioRoot: root,
      spriteBuses: ['empty-sprite-bus'],
      fast: true,
    });

    expect(result.warnings).toBeGreaterThan(0);
    expect(result.lines.some((l) => l.includes('empty sprite map'))).toBe(true);
  });

  it('fails when a sprite entry is not a well-formed [start, duration] pair', async () => {
    const busDir = join(root, 'invalid-entry-bus');
    mkdirSync(busDir, { recursive: true });
    writeFileSync(
      join(busDir, 'sprite.json'),
      JSON.stringify({ src: ['sprite.webm'], sprite: { broken: [0] } }),
    );

    const result = await verifySprites({
      audioRoot: root,
      spriteBuses: ['invalid-entry-bus'],
      fast: true,
    });

    expect(result.failures).toBeGreaterThan(0);
    expect(result.lines.some((l) => l.includes('sprite entry must be [startMs, durationMs]'))).toBe(
      true,
    );
  });

  it('fails on a negative offset or non-positive duration', async () => {
    const busDir = join(root, 'negative-offset-bus');
    mkdirSync(busDir, { recursive: true });
    writeFileSync(
      join(busDir, 'sprite.json'),
      JSON.stringify({ src: ['sprite.webm'], sprite: { bad: [-10, 0] } }),
    );

    const result = await verifySprites({
      audioRoot: root,
      spriteBuses: ['negative-offset-bus'],
      fast: true,
    });

    expect(result.failures).toBeGreaterThan(0);
    expect(result.lines.some((l) => l.includes('invalid offset/duration'))).toBe(true);
  });

  it('supports custom formats', async () => {
    const busDir = join(root, 'missing-files-bus');
    mkdirSync(busDir, { recursive: true });
    writeFileSync(join(busDir, 'sprite.mp3'), 'stub');
    writeFileSync(
      join(busDir, 'sprite.json'),
      JSON.stringify({ src: ['sprite.mp3'], sprite: { click: [0, 100] } }),
    );

    const result = await verifySprites({
      audioRoot: root,
      spriteBuses: ['missing-files-bus'],
      formats: ['mp3'],
      fast: true,
    });

    expect(result.lines.some((l) => l.includes('sprite.mp3 missing'))).toBe(false);
  });

  describe('flatGroups', () => {
    it('passes when every key/format combination is present', async () => {
      const groupDir = join(root, 'crowd-bed');
      mkdirSync(groupDir, { recursive: true });
      writeFileSync(join(groupDir, 'murmur.webm'), 'stub');
      writeFileSync(join(groupDir, 'murmur.m4a'), 'stub');

      const result = await verifySprites({
        audioRoot: root,
        spriteBuses: [],
        flatGroups: [{ dir: 'crowd-bed', keys: ['murmur'] }],
        fast: true,
      });

      expect(result.failures).toBe(0);
      expect(result.lines.some((l) => l.includes('crowd-bed/murmur'))).toBe(true);
    });

    it('warns (not fails) on a missing optional flat-group key', async () => {
      const groupDir = join(root, 'crowd-bed');
      mkdirSync(groupDir, { recursive: true });
      // No files created — 'riot' key entirely absent.

      const result = await verifySprites({
        audioRoot: root,
        spriteBuses: [],
        flatGroups: [{ dir: 'crowd-bed', keys: ['riot'] }],
        fast: true,
      });

      expect(result.failures).toBe(0);
      expect(result.warnings).toBeGreaterThan(0);
      expect(result.lines.some((l) => l.includes('crowd-bed/riot: missing'))).toBe(true);
    });

    it('fails on a missing required flat-group key', async () => {
      const groupDir = join(root, 'crowd-bed-required');
      mkdirSync(groupDir, { recursive: true });

      const result = await verifySprites({
        audioRoot: root,
        spriteBuses: [],
        flatGroups: [{ dir: 'crowd-bed-required', keys: ['riot'], required: true }],
        fast: true,
      });

      expect(result.failures).toBeGreaterThan(0);
      expect(result.lines.some((l) => l.includes('crowd-bed-required/riot: missing'))).toBe(true);
    });

    it.skipIf(!HAS_FFTOOLS)(
      'measures LUFS for flat-group members in non-fast mode and flags out-of-tolerance loudness',
      async () => {
        const groupDir = join(root, 'crowd-bed');
        mkdirSync(groupDir, { recursive: true });
        generateAudio(join(groupDir, 'murmur.webm'), 1);

        const passing = await verifySprites({
          audioRoot: root,
          spriteBuses: [],
          flatGroups: [{ dir: 'crowd-bed', keys: ['murmur'], formats: ['webm'] }],
          fast: false,
          lufsTarget: -20,
          lufsTolerance: 50,
        });
        expect(passing.failures).toBe(0);

        const failing = await verifySprites({
          audioRoot: root,
          spriteBuses: [],
          flatGroups: [{ dir: 'crowd-bed', keys: ['murmur'], formats: ['webm'] }],
          fast: false,
          lufsTarget: -90,
          lufsTolerance: 0.01,
        });
        expect(failing.failures).toBeGreaterThan(0);
        expect(
          failing.lines.some(
            (l) => l.includes('crowd-bed/murmur: LUFS') && l.includes('outside target'),
          ),
        ).toBe(true);
      },
    );

    it('warns when LUFS cannot be measured for a flat-group member (non-fast mode)', async () => {
      const groupDir = join(root, 'crowd-bed');
      mkdirSync(groupDir, { recursive: true });
      writeFileSync(join(groupDir, 'murmur.webm'), 'not real audio');

      const result = await verifySprites({
        audioRoot: root,
        spriteBuses: [],
        flatGroups: [{ dir: 'crowd-bed', keys: ['murmur'], formats: ['webm'] }],
        fast: false,
      });

      expect(result.lines.some((l) => l.includes('crowd-bed/murmur: could not measure LUFS'))).toBe(
        true,
      );
    });

    it('supports per-group format overrides', async () => {
      const groupDir = join(root, 'crowd-bed');
      mkdirSync(groupDir, { recursive: true });
      writeFileSync(join(groupDir, 'murmur.ogg'), 'stub');

      const result = await verifySprites({
        audioRoot: root,
        spriteBuses: [],
        flatGroups: [{ dir: 'crowd-bed', keys: ['murmur'], formats: ['ogg'] }],
        fast: true,
      });

      expect(result.failures).toBe(0);
      expect(result.lines.some((l) => l.includes('crowd-bed/murmur'))).toBe(true);
    });
  });

  describe('byte budget', () => {
    it('passes when total directory size is within budget', async () => {
      const busDir = join(root, 'budget-bus');
      mkdirSync(busDir, { recursive: true });
      writeFileSync(join(busDir, 'small.webm'), 'x'.repeat(100));

      const result = await verifySprites({
        audioRoot: join(root, 'budget-bus'),
        spriteBuses: [],
        maxTotalBytes: 1024,
        fast: true,
      });

      expect(result.failures).toBe(0);
      expect(result.lines.some((l) => l.includes('Budget'))).toBe(true);
    });

    it('fails when total directory size exceeds budget', async () => {
      const busDir = join(root, 'budget-bus');
      mkdirSync(busDir, { recursive: true });
      writeFileSync(join(busDir, 'big.webm'), 'x'.repeat(2048));

      const result = await verifySprites({
        audioRoot: join(root, 'budget-bus'),
        spriteBuses: [],
        maxTotalBytes: 1024,
        fast: true,
      });

      expect(result.failures).toBeGreaterThan(0);
      expect(result.lines.some((l) => l.includes('exceeds') && l.includes('budget'))).toBe(true);
    });

    it('reports zero bytes for a non-existent audio root', async () => {
      const result = await verifySprites({
        audioRoot: join(root, 'does-not-exist-at-all'),
        spriteBuses: [],
        maxTotalBytes: 1024,
        fast: true,
      });

      expect(result.failures).toBe(0);
      expect(result.lines.some((l) => l.includes('0.00MB'))).toBe(true);
    });

    it('is skipped entirely when maxTotalBytes is not supplied', async () => {
      const result = await verifySprites({
        audioRoot: root,
        spriteBuses: [],
        fast: true,
      });

      expect(result.lines.some((l) => l.includes('Budget'))).toBe(false);
    });
  });

  it('summarises failure and warning counts in the final line', async () => {
    const result = await verifySprites({
      audioRoot: join(root, 'does-not-exist-at-all-2'),
      spriteBuses: ['missing-bus-dir'],
      fast: true,
    });

    expect(result.lines.at(-1)).toContain('Summary:');
    expect(result.lines.at(-1)).toContain(`${result.failures} failure(s)`);
    expect(result.lines.at(-1)).toContain(`${result.warnings} warning(s)`);
  });
});

describe('runVerifySpritesCli', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(join(root, 'cli-passing-bus'), { recursive: true, force: true });
  });

  it('logs each result line and does not exit when verification passes', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit should not be called on a passing run');
    }) as unknown as typeof process.exit);

    await runVerifySpritesCli({
      audioRoot: join(root, 'cli-passing-bus'),
      spriteBuses: [],
      fast: true,
    });

    expect(logSpy).toHaveBeenCalled();
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('verification passed'))).toBe(true);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('logs an error and exits 1 when verification fails', async () => {
    const busDir = join(root, 'cli-passing-bus');
    mkdirSync(busDir, { recursive: true });
    // sprite.json missing entirely -> guaranteed failure.

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    await runVerifySpritesCli({
      audioRoot: root,
      spriteBuses: ['cli-passing-bus'],
      fast: true,
    });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('verification FAILED'));
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logSpy).toHaveBeenCalled();
  });
});
