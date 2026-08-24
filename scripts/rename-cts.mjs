#!/usr/bin/env node
/**
 * The CommonJS build ships .cjs files, but tsc emits .d.ts declarations for it.
 * Under node16 module resolution a .d.ts is interpreted as ESM, so `require()`
 * consumers get types that masquerade as ESM — attw reports this as 👺 and it
 * only surfaces outside a workspace, where nothing hoists a fallback.
 *
 * Rename the CJS declaration pass to .d.cts and rewrite its relative import
 * specifiers to match, so `exports.require.types` resolves unambiguously.
 */
import { readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'types-cjs');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const files = await walk(ROOT);

for (const file of files) {
  const target = file.replace(/\.d\.ts$/, '.d.cts');
  let content = await readFile(file, 'utf8');
  // Relative specifiers between declaration files must point at .cjs siblings.
  content = content.replace(
    /(from\s+|import\s*\()(["'])(\.\.?\/[^"']+?)\2/g,
    (match, lead, quote, spec) => {
      if (spec.endsWith('.json')) return match;
      const bare = spec.replace(/\.(js|cjs)$/, '');
      return `${lead}${quote}${bare}.cjs${quote}`;
    },
  );
  await writeFile(target, content, 'utf8');
  await unlink(file);
}

console.log(`Renamed ${files.length} CJS declaration file(s) to .d.cts`);
