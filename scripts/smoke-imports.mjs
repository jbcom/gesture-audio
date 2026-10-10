import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esmRuntime = await import('../dist/esm/index.js');
const esmHowler = await import('../dist/esm/howler.js');
const esmToneLazy = await import('../dist/esm/tone-lazy.js');
const esmBuildTools = await import('../dist/esm/build-tools/index.js');
const cjsRuntime = require('../dist/cjs/index.cjs');
const cjsHowler = require('../dist/cjs/howler.cjs');
const cjsToneLazy = require('../dist/cjs/tone-lazy.cjs');
const cjsBuildTools = require('../dist/cjs/build-tools/index.cjs');

const checks = [
  ['ESM runtime', esmRuntime.startAudioEngine],
  ['CommonJS runtime', cjsRuntime.startAudioEngine],
  ['ESM Howler-only runtime', esmHowler.startAudioEngine],
  ['CommonJS Howler-only runtime', cjsHowler.startAudioEngine],
  ['ESM lazy Tone runtime', esmToneLazy.startToneLazyEngine],
  ['CommonJS lazy Tone runtime', cjsToneLazy.startToneLazyEngine],
  ['ESM Howler-only resolver', esmHowler.playCue],
  ['CommonJS Howler-only resolver', cjsHowler.playCue],
  ['ESM build tools', esmBuildTools.verifySprites],
  ['CommonJS build tools', cjsBuildTools.verifySprites],
];

for (const [label, exported] of checks) {
  if (typeof exported !== 'function') throw new Error(`${label} did not expose its expected API`);
}

// The Howler-only entry must never reach Tone: Tone creates a second
// AudioContext beside Howler's. Walk the *built* module graph of each format.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const SPECIFIER = [
  /\b(?:import|export)\s[^'";]*?\sfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function bareImports(entry) {
  const seen = new Set();
  const bare = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const pattern of SPECIFIER) {
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1];
        if (specifier.startsWith('.')) queue.push(resolve(dirname(file), specifier));
        else bare.add(specifier);
      }
    }
  }
  return [...bare].sort();
}

for (const [label, entry] of [
  ['ESM', resolve(root, 'esm', 'howler.js')],
  ['CommonJS', resolve(root, 'cjs', 'howler.cjs')],
]) {
  const bare = bareImports(entry);
  if (bare.includes('tone')) throw new Error(`${label} Howler-only entry reaches "tone"`);
  if (bare.join() !== 'howler') {
    throw new Error(`${label} Howler-only entry imports unexpected packages: ${bare.join(', ')}`);
  }
}

// The lazy Tone entry is the Howler-free side: an app on it installs only
// `tone`, so its graph (the dynamic runtime chunk included) must never reach
// `howler`, which is an optional peer for exactly that reason.
for (const [label, entry] of [
  ['ESM', resolve(root, 'esm', 'tone-lazy.js')],
  ['CommonJS', resolve(root, 'cjs', 'tone-lazy.cjs')],
]) {
  const bare = bareImports(entry);
  if (bare.join() !== 'tone') {
    throw new Error(`${label} lazy Tone entry imports unexpected packages: ${bare.join(', ')}`);
  }
}

console.log(
  'ESM and CommonJS runtime/Howler-only/lazy-Tone/build-tools imports succeeded; Howler entry is Tone-free and lazy Tone entry is Howler-free.',
);
