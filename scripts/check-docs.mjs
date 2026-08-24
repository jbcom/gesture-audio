import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const documents = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CHANGELOG.md',
  'AGENTS.md',
  'llms.txt',
  'examples/README.md',
  'docs/architecture.md',
  'docs/api-reference.md',
  'docs/changelog.md',
  'docs/contributing.md',
  'docs/index.md',
  'docs/quick-start.md',
  'docs/releasing.md',
  'docs/security.md',
  'docs/sprite-maps.md',
  'docs/troubleshooting.md',
];
const failures = [];

for (const document of documents) {
  if (!existsSync(document)) {
    failures.push(`${document}: file is missing`);
    continue;
  }
  const source = readFileSync(document, 'utf8');
  for (const match of source.matchAll(/!?(?:\[[^\]]*\])\(([^)]+)\)/g)) {
    const target = match[1]?.trim();
    if (!target || /^(?:https?:|mailto:|#)/.test(target)) continue;
    let path;
    try {
      path = decodeURIComponent(target.split('#', 1)[0] ?? '');
    } catch {
      failures.push(`${document}: malformed link target ${target}`);
      continue;
    }
    if (path && !existsSync(resolve(dirname(document), path))) {
      failures.push(`${document}: broken relative link ${target}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${documents.length} Markdown files; all relative links resolve.`);
}
