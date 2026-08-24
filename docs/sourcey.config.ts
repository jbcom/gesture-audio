import { defineConfig, markdown } from 'sourcey';

export default defineConfig({
  name: 'gesture-audio',
  siteUrl: 'https://jonbogaty.com',
  baseUrl: '/gesture-audio',
  theme: {
    preset: 'default',
    colors: {
      primary: '#d96f52',
      light: '#f08665',
      dark: '#a84832',
    },
    fonts: {
      sans: 'Inter',
      mono: 'JetBrains Mono',
    },
    layout: {
      sidebar: '18rem',
      toc: '19rem',
      content: '46rem',
    },
    css: ['./theme.css'],
  },
  logo: { light: './assets/gesture-audio-mark.svg', href: '/gesture-audio/' },
  favicon: './favicon.svg',
  ogImage: './assets/gesture-audio-hero.webp',
  repo: 'https://github.com/jbcom/gesture-audio',
  editBranch: 'main',
  editBasePath: 'docs',
  prettyUrls: 'slash',
  navbar: {
    links: [
      { type: 'github', href: 'https://github.com/jbcom/gesture-audio' },
      {
        type: 'link',
        label: 'npm',
        href: 'https://www.npmjs.com/package/gesture-audio',
      },
    ],
  },
  footer: {
    links: [{ type: 'github', href: 'https://github.com/jbcom/gesture-audio' }],
  },
  navigation: {
    tabs: [
      {
        tab: 'Documentation',
        slug: '',
        source: markdown({
          groups: [
            {
              group: 'Getting Started',
              pages: ['index', 'quick-start', 'sprite-maps'],
            },
            {
              group: 'Reference',
              pages: ['api-reference'],
            },
            {
              group: 'Guides',
              pages: ['architecture', 'troubleshooting', 'releasing'],
            },
            {
              group: 'Project',
              pages: ['contributing', 'security', 'changelog'],
            },
          ],
        }),
      },
    ],
  },
});
