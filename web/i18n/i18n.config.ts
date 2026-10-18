import { fallbackLocales } from '../i18n-constants';

/**
 * vue-i18n's own options. `fallbackLocale` belongs here rather than in
 * nuxt.config: @nuxtjs/i18n's module options do not carry it, so the entry that
 * used to sit there was silently ignored.
 */
export default defineI18nConfig(() => ({
  fallbackLocale: fallbackLocales,
}));
