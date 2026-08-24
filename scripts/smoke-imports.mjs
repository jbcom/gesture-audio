import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const esmRuntime = await import('../dist/esm/index.js');
const esmBuildTools = await import('../dist/esm/build-tools/index.js');
const cjsRuntime = require('../dist/cjs/index.cjs');
const cjsBuildTools = require('../dist/cjs/build-tools/index.cjs');

const checks = [
  ['ESM runtime', esmRuntime.startAudioEngine],
  ['CommonJS runtime', cjsRuntime.startAudioEngine],
  ['ESM build tools', esmBuildTools.verifySprites],
  ['CommonJS build tools', cjsBuildTools.verifySprites],
];

for (const [label, exported] of checks) {
  if (typeof exported !== 'function') throw new Error(`${label} did not expose its expected API`);
}

console.log('ESM and CommonJS runtime/build-tools imports succeeded.');
