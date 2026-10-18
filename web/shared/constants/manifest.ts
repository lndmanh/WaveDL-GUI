import { defaultLocale } from '../../i18n-constants';

/** Annotated rather than inferred: the manifest schema expects these literals. */
const DISPLAY_OVERRIDE: ('window-controls-overlay' | 'standalone')[] = [
  'window-controls-overlay',
  'standalone',
];

export const APP_MANIFEST = {
  name: 'Nuxt Starter Kit',
  short_name: 'Nuxt Template',
  description: 'A Nuxt 4 starter template with NuxtHub, Auth, and PWA support',
  start_url: '/pwa',
  display: 'standalone' as const,
  display_override: DISPLAY_OVERRIDE,
  background_color: '#ffffff',
  theme_color: '#8b5cf6',
  dir: 'ltr' as const,
  lang: defaultLocale,
  orientation: 'any' as const,
  scope: '/',
  categories: ['education', 'productivity', 'technology', 'business'],
  iarc_rating_id: '',
  icons: [
    {
      src: 'pwa-64x64.png',
      sizes: '64x64',
      type: 'image/png',
    },
    {
      src: 'pwa-192x192.png',
      sizes: '192x192',
      type: 'image/png',
    },
    {
      src: 'pwa-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: 'maskable-icon-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
  screenshots: [
    {
      src: 'pwa-512x512.png',
      sizes: '512x512',
      type: 'image/png',
      form_factor: 'wide' as const,
    },
    {
      src: 'pwa-192x192.png',
      sizes: '192x192',
      type: 'image/png',
      form_factor: 'narrow' as const,
    },
  ],
  shortcuts: [
    {
      name: 'Home',
      short_name: 'Home',
      description: 'Go to home page',
      url: '/',
      icons: [
        {
          src: 'pwa-192x192.png',
          sizes: '192x192',
          type: 'image/png',
        },
      ],
    },
    {
      name: 'Dashboard',
      short_name: 'Dashboard',
      description: 'Sample shortcut to dashboard',
      url: '/dashboard',
    },
  ],
  scope_extensions: [
    {
      origin: '*',
    },
  ],
};

// SEO-related constants
export const SEO_CONFIG = {
  author: 'No Name Studio',
  keywords: 'nuxt, template, pwa, starter, vue, javascript',
  ogImage: '/pwa-512x512.png',
  twitterCard: 'summary_large_image' as const,
  robots: 'index, follow',
  colorScheme: 'light dark',
} as const;
