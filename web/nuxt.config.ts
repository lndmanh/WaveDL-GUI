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

// Preserve the upstream scaffold in app/ for manifest-based three-way upgrades.
// Only workstation/ is application code; there is no Nitro API or backend.
export default defineNuxtConfig({
  ssr: false,
  srcDir: 'workstation',
  dir: { public: 'workstation/public' },
  modules: ['@vite-pwa/nuxt'],
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
  // Retained-build consent owns reloads. Nuxt's automatic chunk-error and
  // outdated-build plugins could otherwise reload a tab without its explicit
  // Update and reload approval.
  experimental: {
    emitRouteChunkError: false,
    checkOutdatedBuildInterval: false,
  },
  app: {
    head: {
      title: 'WaveDL Workstation',
      htmlAttrs: { lang: 'en' },
      meta: [{ name: 'description', content: 'A local interface to the WaveDL daemon.' }],
      link: [
        { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
      ],
    },
  },
  nitro: {
    preset: 'static',
    prerender: { routes: ['/'], crawlLinks: false },
  },
  pwa: {
    strategies: 'injectManifest',
    registerType: 'prompt',
    client: { registerPlugin: false },
    srcDir: 'service-worker',
    filename: 'sw.ts',
    injectManifest: {
      globPatterns: ['**/*.{js,css,html,svg,ico,png,woff2}'],
      // Nuxt rewrites 200.html/404.html to extensionless URLs which the daemon
      // intentionally does not serve to non-navigation precache requests.
      globIgnores: ['api/**', '200.html', '404.html'],
      maximumFileSizeToCacheInBytes: 4_000_000,
    },
    manifest: {
      name: 'WaveDL Workstation',
      short_name: 'WaveDL',
      description: 'A daemon-connected workspace for wave-based inverse problems.',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#f5f5f7',
      theme_color: '#f5f5f7',
      icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    },
    devOptions: { enabled: false },
  },
  typescript: { strict: true },
  vite: { plugins: [tailwindcss()] },
});
