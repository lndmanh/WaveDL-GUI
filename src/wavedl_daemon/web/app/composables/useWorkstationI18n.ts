import { configureValidationLocale } from '../i18n/client-messages';
import type { Locale } from '~~/types/i18n';

/** Appearance preferences are the sole owner of the application's locale. */
export function provideWorkstationLocale(locale: Readonly<Ref<Locale>>): void {
  const composer = useI18n({ useScope: 'global' });
  watch(
    locale,
    (value) => {
      composer.locale.value = value;
      configureValidationLocale(value);
    },
    { immediate: true, flush: 'sync' },
  );
}
