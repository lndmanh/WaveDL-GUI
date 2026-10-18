import { computed, hasInjectionContext, inject, provide, type InjectionKey, type Ref } from 'vue';
import {
  translateKnownMessage,
  translateMessage,
  type MessageCatalog,
  type MessageParams,
  type WorkstationLocale,
} from '../i18n/core';

const workstationLocaleKey: InjectionKey<Readonly<Ref<WorkstationLocale>>> =
  Symbol('workstation-locale');

/** The appearance owner provides a read-only source; consumers cannot alter preferences. */
export function provideWorkstationLocale(locale: Readonly<Ref<WorkstationLocale>>): void {
  provide(
    workstationLocaleKey,
    computed(() => locale.value),
  );
}

export function useWorkstationI18n<Key extends string>(catalog: MessageCatalog<Key>) {
  // Isolated components/tests default to English without a shared mutable global.
  const fallback = computed<WorkstationLocale>(() => 'en');
  const locale = hasInjectionContext() ? inject(workstationLocaleKey, fallback) : fallback;
  return {
    locale,
    t: (key: Key, params?: MessageParams) => translateMessage(catalog, locale.value, key, params),
    translateKnownMessage: (rawEnglish: string) =>
      translateKnownMessage(catalog, locale.value, rawEnglish),
  };
}
