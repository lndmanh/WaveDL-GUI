// @vitest-environment happy-dom
import { createTestI18n, mountWithI18n as mount } from './mountWithI18n';
import { flushPromises } from '@vue/test-utils';
import { defineComponent, h, shallowRef } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkstationShell from '../../app/components/shell/WorkstationShell.vue';
import ConnectionPanel from '../../app/components/ConnectionPanel.vue';
import SettingsWorkspace from '../../app/components/settings/SettingsWorkspace.vue';
import TrainingDefaultsSettings from '../../app/components/settings/TrainingDefaultsSettings.vue';
import {
  defaultAppearance,
  loadAppearance,
  type AppearancePreferences,
} from '../../app/lib/preferences';
import { clientError, configureValidationLocale } from '../../app/i18n/client-messages';

async function chooseSelectOption(wrapper: ReturnType<typeof mount>, id: string, value: string) {
  await wrapper
    .get(`#${id}`)
    .trigger('pointerdown', { button: 0, ctrlKey: false, pointerType: 'mouse', pointerId: 1 });
  await flushPromises();
  const option = document.body.querySelector<HTMLElement>(`[role="option"][data-value="${value}"]`);
  expect(option).not.toBeNull();
  option?.click();
  await wrapper.get(`#${id}`).trigger('keydown', { key: 'ArrowDown' });
  await wrapper.get(`#${id}`).trigger('keydown', { key: 'Enter' });
  await flushPromises();
}

beforeEach(() => {
  const items = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => {
        items.set(key, value);
      },
      removeItem: (key: string) => {
        items.delete(key);
      },
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  configureValidationLocale('en');
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('style');
});

describe('shell and settings live localization', () => {
  it('saves language through the existing event and switches mounted shell without resetting fields', async () => {
    const i18n = createTestI18n('en');
    const appearance = shallowRef<AppearancePreferences>({ ...defaultAppearance });
    const Host = defineComponent({
      setup() {
        return () =>
          h(
            WorkstationShell,
            { status: 'offline', section: 'experiments', overlay: null },
            {
              default: () =>
                h(SettingsWorkspace, {
                  daemonId: null,
                  appearance: appearance.value,
                  onAppearanceChanged: (value: AppearancePreferences) => {
                    appearance.value = value;
                    i18n.global.locale.value = value.language;
                  },
                }),
            },
          );
      },
    });
    const wrapper = mount(Host, undefined, i18n);
    await flushPromises();
    const initial = wrapper.get('#preference-theme').element;
    await chooseSelectOption(wrapper, 'preference-theme', 'dark');
    await chooseSelectOption(wrapper, 'preference-language', 'vi');
    appearance.value = { ...appearance.value, language: 'vi' };
    i18n.global.locale.value = 'vi';
    expect(wrapper.text()).toContain('Save appearance');
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Browser preferences saved.'));
    expect(wrapper.text()).toContain('Offline');
    expect(wrapper.get('[data-testid="workstation-nav"]').attributes('aria-label')).toBe(
      'Sections',
    );
    expect(wrapper.get('#preference-theme').text()).toContain('System');
    expect(wrapper.get('#preference-theme').element).toBe(initial);
    expect(loadAppearance().language).toBe('en');
    expect(wrapper.get('#preference-language').exists()).toBe(true);
    await chooseSelectOption(wrapper, 'preference-language', 'en');
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Browser preferences saved.'));
    wrapper.unmount();
  });

  it('applies Vietnamese for the session when storage rejects saving, and translates the stored notice on switch', async () => {
    const i18n = createTestI18n('en');
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const appearance = shallowRef<AppearancePreferences>({ ...defaultAppearance });
    const Host = defineComponent({
      setup() {
        return () =>
          h(SettingsWorkspace, {
            daemonId: null,
            appearance: appearance.value,
            onAppearanceChanged: (value: AppearancePreferences) => {
              appearance.value = value;
              i18n.global.locale.value = value.language;
            },
          });
      },
    });
    const wrapper = mount(Host, undefined, i18n);
    await flushPromises();
    await chooseSelectOption(wrapper, 'preference-language', 'vi');
    i18n.global.locale.value = 'vi';
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('Applied for this session. Browser storage is unavailable.'),
    );
    expect(loadAppearance().language).toBe('en');
    appearance.value = { ...appearance.value, language: 'en' };
    i18n.global.locale.value = 'en';
    await flushPromises();
    expect(wrapper.text()).toContain('Applied for this session. Browser storage is unavailable.');
    wrapper.unmount();
  });

  it('switches connection notices and validation while preserving an entered credential', async () => {
    const i18n = createTestI18n('en');
    const message = shallowRef(clientError('yourSessionEndedSignInAgain'));
    const Host = defineComponent({
      setup() {
        return () =>
          h(ConnectionPanel, {
            state: {
              status: 'authentication',
              health: null,
              revision: 0,
              message: message.value,
            },
          });
      },
    });
    const wrapper = mount(Host, undefined, i18n);
    await flushPromises();
    await wrapper.get('#daemon-bearer').setValue('private-token');
    i18n.global.locale.value = 'vi';
    configureValidationLocale('vi');
    await flushPromises();
    expect(wrapper.text()).toContain('Phiên của bạn đã kết thúc. Hãy đăng nhập lại.');
    expect(wrapper.get('#daemon-bearer').element).toHaveProperty('value', 'private-token');
    message.value = clientError('daemonReplaced');
    await flushPromises();
    expect(wrapper.text()).toContain(
      'WaveDL đã được khởi động lại hoặc thay thế. Hãy đăng nhập lại.',
    );
    await wrapper.get('#daemon-bearer').setValue('');
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('Dán khóa truy cập của bạn.'),
    );
    wrapper.unmount();
  });

  it('translates saved training notices at render time without resetting unsaved defaults', async () => {
    const i18n = createTestI18n('en');
    const Host = defineComponent({
      setup() {
        return () => h(TrainingDefaultsSettings, { daemonId: 'stable-daemon' });
      },
    });
    const wrapper = mount(Host, undefined, i18n);
    await flushPromises();
    await wrapper.get('[id$="-training-epochs"]').setValue('17');
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('Defaults saved for new drafts on this daemon.'),
    );
    await wrapper.get('[id$="-training-epochs"]').setValue('29');
    i18n.global.locale.value = 'vi';
    await flushPromises();
    expect(wrapper.text()).toContain('Đã lưu mặc định cho bản nháp mới trên daemon này.');
    expect(wrapper.get('[id$="-training-epochs"]').element).toHaveProperty('value', '29');
    wrapper.unmount();
  });
});
