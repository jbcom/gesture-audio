// @ts-check
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightLlmsTxt from 'starlight-llms-txt';
import starlightTypeDoc, { typeDocSidebarGroup } from 'starlight-typedoc';

// GitHub Pages deploys under the repo path. CI/CD set ASTRO_BASE + ASTRO_SITE
// to the real jonbogaty.com/gesture-audio/ path; local dev falls back to `/`.
const base = process.env.ASTRO_BASE ?? '/';
const site = process.env.ASTRO_SITE ?? 'https://jonbogaty.com/gesture-audio';

// Mirrors src/index.ts + src/build-tools/index.ts — the two public entry
// points defined in package.json#exports.
const entryPoints = ['../src/index.ts', '../src/build-tools/index.ts'];

export default defineConfig({
  site,
  base,
  integrations: [
    starlight({
      title: 'gesture-audio',
      description:
        'Gesture-gated Tone.js bus graph + Howler sprite resolver + preferences bridge for reliable browser audio unlock.',
      favicon: '/favicon.svg',
      logo: {
        src: './src/assets/gesture-audio-mark.svg',
        replacesTitle: false,
      },
      customCss: ['./src/styles/theme.css'],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/jbcom/gesture-audio' },
        {
          icon: 'npm',
          label: 'npm',
          href: 'https://www.npmjs.com/package/@jbdevprimary/gesture-audio',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/jbcom/gesture-audio/edit/main/docs-site/',
      },
      lastUpdated: true,
      pagination: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 4 },
      plugins: [
        // llms.txt (https://llmstxt.org) — the entry point AI agents read
        // before consuming the rest of the docs. Emits /llms.txt (index),
        // /llms-small.txt (curated core), and /llms-full.txt (everything,
        // incl. the typedoc reference) at build time.
        starlightLlmsTxt({
          projectName: 'gesture-audio',
          description:
            'Gesture-gated Tone.js bus graph + Howler sprite resolver + preferences bridge that treats Web Audio unlock and application bootstrap as one concurrent-safe, retryable transaction.',
          details: [
            'Install with `npm install @jbdevprimary/gesture-audio tone howler` — tone and howler are peer dependencies.',
            'Register `registerAudioGestureTrigger` early in application startup; all audio bootstrap runs inside its callback after the first click, keydown, or touchstart.',
            'Import the Node-only asset verifier from the separate `@jbdevprimary/gesture-audio/build-tools` subpath so filesystem/process code never enters a browser bundle.',
            'The package does not define cue names, gameplay policy, or a persistence framework — those stay in the consuming application.',
          ].join('\n'),
          exclude: ['reference/**'],
        }),
        starlightTypeDoc({
          entryPoints,
          tsconfig: './tsconfig.typedoc.json',
          output: 'reference',
          sidebar: { label: 'API Reference', collapsed: false },
          typeDoc: {
            plugin: ['typedoc-plugin-markdown'],
            entryPointStrategy: 'expand',
            excludeInternal: true,
            excludePrivate: true,
            hideGenerator: true,
          },
        }),
      ],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Overview', slug: 'index' },
            { label: 'Quick start', slug: 'guides/quick-start' },
            { label: 'Sprite maps', slug: 'guides/sprite-maps' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Architecture', slug: 'guides/architecture' },
            { label: 'Releasing', slug: 'guides/releasing' },
            { label: 'Troubleshooting', slug: 'guides/troubleshooting' },
          ],
        },
        typeDocSidebarGroup,
      ],
    }),
  ],
});
