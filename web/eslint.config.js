// @ts-check
import { createConfigForNuxt } from '@nuxt/eslint-config/flat';
import betterTailwindcss from 'eslint-plugin-better-tailwindcss';
import oxlint from 'eslint-plugin-oxlint';

export default createConfigForNuxt({
  features: { stylistic: false, tooling: true, typescript: true },
})
  // Global ignores (shadcn ui is generated; content/skills/migrations are not our source).
  .append({
    ignores: [
      '**/dist/**',
      '**/dist-ssr/**',
      '**/coverage/**',
      'app/components/ui/**',
      'content/**',
      'skills/**',
      'server/db/migrations/**',
      // Fixture kits are fake project sources the CLI renders in tests.
      'packages/*/test/fixtures/**',
    ],
  })
  .override('nuxt/vue/rules', {
    files: ['app/pages/**/*.vue', 'app/layouts/**/*.vue'],
    rules: { 'vue/multi-word-component-names': 'off' },
  })
  .append({
    files: ['app/**/*.vue'],
    plugins: { 'better-tailwindcss': betterTailwindcss },
    rules: {
      'better-tailwindcss/enforce-canonical-classes': 'error',
      'better-tailwindcss/no-conflicting-classes': 'error',
      'better-tailwindcss/no-duplicate-classes': 'error',
      'better-tailwindcss/no-unnecessary-whitespace': 'error',
    },
    settings: {
      'better-tailwindcss': {
        entryPoint: 'app/assets/css/tailwind.css',
        rootFontSize: 16,
      },
    },
  })
  .append(...oxlint.configs['flat/recommended'])
  .append({
    files: ['**/*.ts', '**/*.mts', '**/*.tsx', '**/*.vue'],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
  })
  .append({
    files: ['**/*.vue'],
    rules: {
      // oxfmt owns self-closing; keeping this on starts a formatter-vs-linter war.
      'vue/html-self-closing': 'off',
      // Dual-script SFCs (module `<script>` + `<script setup>`) declare module-scope
      // consts that defineProps defaults reference. import/first reorders those below
      // the setup imports, which breaks `defineProps()` hoisting.
      'import/first': 'off',
    },
  })
  .append({
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  });
