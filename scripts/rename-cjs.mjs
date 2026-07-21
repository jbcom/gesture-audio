#!/usr/bin/env node
/**
 * tsc emits dist/cjs/**\/*.js for the CommonJS build. Rename every .js to
 * .cjs (and fix up sibling require() specifiers) so Node's package.json
 * `exports.require` resolves unambiguously against the ESM build's .js
 * files living in a sibling directory.
 */
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cjs');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const jsFiles = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      jsFiles.push(...(await walk(full)));
    } else if (entry.name.endsWith('.js')) {
      jsFiles.push(full);
    }
  }
  return jsFiles;
}

const jsFiles = await walk(ROOT);

for (const file of jsFiles) {
  const cjsFile = file.replace(/\.js$/, '.cjs');
  let content = await readFile(file, 'utf8');
  // Fix relative require()/exports specifiers that reference sibling .js
  // files emitted by this same pass (now renamed to .cjs).
  content = content.replace(
    /require\((["'])(\.\.?\/[^"']+?)\1\)/g,
    (match, quote, spec) => {
      if (spec.endsWith('.json')) return match;
      const withoutJs = spec.endsWith('.js') ? spec.slice(0, -3) : spec;
      return `require(${quote}${withoutJs}.cjs${quote})`;
    },
  );
  await writeFile(cjsFile, content, 'utf8');
  await import('node:fs/promises').then((fs) => fs.unlink(file));
}

console.log(`Renamed ${jsFiles.length} CJS output file(s) to .cjs`);
