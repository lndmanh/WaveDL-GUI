import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    include: ['test/workstation/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./app', import.meta.url)),
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '#app': fileURLToPath(new URL('./test/nuxt-imports.ts', import.meta.url)),
      '#imports': fileURLToPath(new URL('./test/nuxt-imports.ts', import.meta.url)),
      'vue-router': fileURLToPath(
        new URL('./node_modules/nuxt/node_modules/vue-router/dist/vue-router.js', import.meta.url),
      ),
    },
  },
});
