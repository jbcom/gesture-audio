/**
 * Tests: the `gesture-audio/howler` entry point is Tone-free.
 *
 * Importing Tone creates its own AudioContext next to Howler's. A Howler-only
 * application must be able to import this entry without that, so the whole
 * module graph reachable from src/howler.ts may import `howler` and relative
 * modules only.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function specifiersOf(source: string): string[] {
  const code = stripComments(source);
  const found = new Set<string>();
  const patterns = [
    /\b(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) if (match[1]) found.add(match[1]);
  }
  return [...found];
}

/** Walk relative imports from `entry` (a .ts file) and collect every bare specifier. */
function bareImportsReachableFrom(entry: string): { bare: string[]; files: string[] } {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('.')) {
        queue.push(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')));
      } else {
        bare.add(specifier);
      }
    }
  }
  return { bare: [...bare].sort(), files: [...seen].sort() };
}

describe('gesture-audio/howler module graph', () => {
  it('reaches howler and no other package, and never tone', () => {
    const { bare, files } = bareImportsReachableFrom(join(SRC, 'howler.ts'));
    expect(bare).toEqual(['howler']);
    expect(bare).not.toContain('tone');
    expect(files.map((file) => file.slice(SRC.length + 1))).toEqual([
      'howler-unlock.ts',
      'howler.ts',
      'sprite-resolver.ts',
      'unlock-controller.ts',
    ]);
  });

  it('the root entry does reach tone, so the walker can see it', () => {
    expect(bareImportsReachableFrom(join(SRC, 'index.ts')).bare).toContain('tone');
  });

  it('detects tone however it is imported', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ga-graph-'));
    try {
      const variants: Record<string, string> = {
        'static.ts': `import * as Tone from 'tone';\nexport const a = Tone;`,
        'named.ts': `import { start } from "tone";\nexport { start };`,
        'reexport.ts': `export { start } from 'tone';`,
        'bare.ts': `import 'tone';`,
        'dynamic.ts': `export const load = () => import('tone');`,
        'require.ts': `const t = require('tone');\nexport { t };`,
      };
      for (const [name, source] of Object.entries(variants)) {
        writeFileSync(join(dir, name), source);
        expect(bareImportsReachableFrom(join(dir, name)).bare, name).toEqual(['tone']);
      }
      mkdirSync(join(dir, 'nested'));
      writeFileSync(join(dir, 'nested', 'leaf.ts'), `import 'tone';`);
      writeFileSync(join(dir, 'indirect.ts'), `export * from './nested/leaf.js';`);
      expect(bareImportsReachableFrom(join(dir, 'indirect.ts')).bare).toEqual(['tone']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores a mention of tone in comments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ga-graph-'));
    try {
      writeFileSync(
        join(dir, 'commented.ts'),
        `// import 'tone';\n/* import * as Tone from 'tone'; */\nimport 'howler';`,
      );
      expect(bareImportsReachableFrom(join(dir, 'commented.ts')).bare).toEqual(['howler']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('gesture-audio/howler exports', () => {
  it('loads with tone unavailable and exposes the lifecycle and resolver API', async () => {
    vi.resetModules();
    vi.doMock('tone', () => {
      throw new Error('tone must not be loaded by the Howler-only entry');
    });
    try {
      const entry = await import('../src/howler');
      expect(Object.keys(entry).sort()).toEqual(
        [
          '_getCueMap',
          '_getLastResolverOptions',
          '_resetAudioEngine',
          'disposeSpriteResolver',
          'fadeCue',
          'initSpriteResolver',
          'isAudioEngineStarted',
          'pauseCue',
          'playCue',
          'registerAudioGestureTrigger',
          'resumeCue',
          'setAudioListener',
          'setCueGain',
          'setCuePosition',
          'setResolverMasterBus',
          'setResolverMute',
          'setResolverVolume',
          'startAudioEngine',
          'stopCue',
        ].sort(),
      );
    } finally {
      vi.doUnmock('tone');
    }
  });
});
