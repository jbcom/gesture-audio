import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve('docs/dist');
const required = [
  'index.html',
  'quick-start/index.html',
  'api-reference/index.html',
  'architecture/index.html',
  'sitemap.xml',
  'llms.txt',
  'llms-full.txt',
  'search-index.json',
  '_og/static.webp',
];

for (const file of required) {
  await access(resolve(output, file));
}

const [index, sitemap, llms] = await Promise.all(
  ['index.html', 'sitemap.xml', 'llms.txt'].map((file) => readFile(resolve(output, file), 'utf8')),
);

const requiredText = [
  ['index.html', index, 'https://jonbogaty.com/gesture-audio/'],
  ['index.html', index, 'og:image'],
  ['sitemap.xml', sitemap, 'https://jonbogaty.com/gesture-audio/quick-start/'],
  ['llms.txt', llms, '/quick-start/'],
];

for (const [file, contents, expected] of requiredText) {
  if (!contents.includes(expected)) {
    throw new Error(`Sourcey output ${file} is missing ${expected}`);
  }
}

if (llms.includes('docs-site') || llms.includes('starlight')) {
  throw new Error('Sourcey llms.txt still refers to the retired documentation site');
}

console.log(
  'Sourcey output contains required routes, agent context, sitemap, and social metadata.',
);
