import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { watch } from 'vue';
import { configureValidationLocale } from '../../app/i18n/client-messages';
import { messages } from '../../app/i18n/messages';

export function createTestI18n(locale: 'en' | 'vi' = 'en') {
  return createI18n({
    legacy: false,
    globalInjection: false,
    locale,
    fallbackLocale: 'en',
    messages,
  });
}

/** Each mount owns its composer: tests cannot leak a locale into another mount. */
export function mountWithI18n(
  component: Parameters<typeof mount>[0],
  options?: Parameters<typeof mount>[1],
  composer = createTestI18n(),
) {
  const stopLocaleWatch = watch(
    composer.global.locale,
    (locale) => configureValidationLocale(locale),
    { immediate: true, flush: 'sync' },
  );
  const wrapper = mount(component, {
    ...options,
    global: {
      ...options?.global,
      plugins: [composer, ...(options?.global?.plugins ?? [])],
    },
  });
  const unmount = wrapper.unmount.bind(wrapper);
  wrapper.unmount = () => {
    stopLocaleWatch();
    unmount();
  };
  return wrapper;
}
