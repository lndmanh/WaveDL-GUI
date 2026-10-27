import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';

// The browser must identify the Python build it was shipped with. Updating the
// package cannot silently retain a stale hard-coded client build identifier.
const versionSource = readFileSync(new URL('../src/wavedl/__init__.py', import.meta.url), 'utf8');
const version = versionSource.match(/^__version__ = "([A-Za-z0-9.+_-]+)"$/m)?.[1];
if (!version) throw new Error('Cannot determine the WaveDL package build identity');
const identityPath = new URL('./workstation/lib/build-identity.ts', import.meta.url);
const identitySource = `/** Generated from the Python package version by nuxt.config.ts. */\nexport const CLIENT_BUILD_ID = '${version}';\n`;
if (readFileSync(identityPath, 'utf8') !== identitySource)
  writeFileSync(identityPath, identitySource);

// app/ holds shared UI primitives and theme CSS. Only workstation/ is
// application code; there is no Nitro API or backend.
export default defineNuxtConfig({
  ssr: false,
  srcDir: 'workstation',
  dir: { public: 'workstation/public' },
  components: false,
  imports: { scan: false },
  alias: {
    '@': fileURLToPath(new URL('./app', import.meta.url)),
  },
  css: ['@/assets/css/tailwind.css'],
  devtools: { enabled: false },
  telemetry: false,
  debug: false,
  compatibilityDate: '2026-10-05',
  // Build skew is surfaced by daemon health. Keep Nuxt's automatic chunk-error
  // and outdated-build plugins disabled so reloads remain user initiated.
  experimental: {
    emitRouteChunkError: false,
    checkOutdatedBuildInterval: false,
  },
  app: {
    head: {
      title: 'WaveDL Workstation',
      htmlAttrs: { lang: 'en' },
      meta: [{ name: 'description', content: 'A local interface to the WaveDL daemon.' }],
      link: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
    },
  },
  nitro: {
    preset: 'static',
    prerender: { routes: ['/'], crawlLinks: false },
  },
  typescript: { strict: true },
  vite: { plugins: [tailwindcss()] },
});
