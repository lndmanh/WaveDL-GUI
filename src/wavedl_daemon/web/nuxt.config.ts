import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import tailwindcss from '@tailwindcss/vite';
import type { NuxtModule } from 'nuxt/schema';

// i18n also installs Router v4; resolve the page tooling from Nuxt's own v5 dependency.
const nuxtRequire = createRequire(import.meta.resolve('nuxt'));
const nuxtRouterRouteBlockPlugin = nuxtRequire.resolve('vue-router/volar/sfc-route-blocks');
const fixNuxtRouterVolarResolution: NuxtModule = (_options, nuxt) => {
  nuxt.hook('modules:done', () => {
    nuxt.hook('prepare:types', ({ tsConfig }) => {
      const plugins = tsConfig.vueCompilerOptions?.plugins;
      if (!plugins) return;
      tsConfig.vueCompilerOptions.plugins = plugins.map((plugin) =>
        plugin === 'vue-router/volar/sfc-route-blocks' ? nuxtRouterRouteBlockPlugin : plugin,
      );
    });
  });
};

// The browser must identify the Python build it was shipped with. Updating the
// package cannot silently retain a stale hard-coded client build identifier.
const versionSource = readFileSync(new URL('../../wavedl/__init__.py', import.meta.url), 'utf8');
const version = versionSource.match(/^__version__ = "([A-Za-z0-9.+_-]+)"$/m)?.[1];
if (!version) throw new Error('Cannot determine the WaveDL package build identity');
const identityPath = new URL('./app/lib/build-identity.ts', import.meta.url);
const identitySource = `/** Generated from the Python package version by nuxt.config.ts. */\nexport const CLIENT_BUILD_ID = '${version}';\n`;
if (readFileSync(identityPath, 'utf8') !== identitySource)
  writeFileSync(identityPath, identitySource);

// The Nuxt 4 default app/ source root contains the browser application. There is
// no Nitro API or backend.
export default defineNuxtConfig({
  ssr: false,
  modules: ['@nuxtjs/i18n', fixNuxtRouterVolarResolution],
  i18n: {
    strategy: 'no_prefix',
    detectBrowserLanguage: false,
    locales: ['en', 'vi'],
    defaultLocale: 'en',
    vueI18n: './i18n.config.ts',
    bundle: { runtimeOnly: false, fullInstall: false },
  },
  hooks: {
    'nitro:config'(nitro) {
      // Both locales are static imports in vueI18n. The daemon has no Nitro
      // runtime, so do not generate the module's unused messages endpoint.
      nitro.handlers = nitro.handlers?.filter((handler) => !handler.route?.startsWith('/_i18n/'));
    },
  },
  components: false,
  imports: { scan: false },
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
