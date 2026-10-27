// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils';
import { computed, defineComponent, h, shallowRef } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkstationShell from '../../app/components/WorkstationShell.vue';
import ConnectionPanel from '../../app/components/ConnectionPanel.vue';
import SettingsWorkspace from '../../app/components/settings/SettingsWorkspace.vue';
import TrainingDefaultsSettings from '../../app/components/settings/TrainingDefaultsSettings.vue';
import { provideWorkstationLocale } from '../../app/composables/useWorkstationI18n';
import {
  defaultAppearance,
  loadAppearance,
  type AppearancePreferences,
} from '../../app/lib/preferences';
import type { WorkstationLocale } from '../../app/i18n/core';

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
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('style');
});

describe('shell and settings live localization', () => {
  it('saves language through the existing event and switches mounted shell without resetting fields', async () => {
    const appearance = shallowRef<AppearancePreferences>({ ...defaultAppearance });
    const Host = defineComponent({
      setup() {
        provideWorkstationLocale(computed(() => appearance.value.language));
        return () =>
          h(
            WorkstationShell,
            { status: 'offline', section: 'settings' },
            {
              default: () =>
                h(SettingsWorkspace, {
                  daemonId: null,
                  appearance: appearance.value,
                  onAppearanceChanged: (value: AppearancePreferences) => {
                    appearance.value = value;
                  },
                }),
            },
          );
      },
    });
    const wrapper = mount(Host);
    await flushPromises();
    const initial = wrapper.get('#preference-theme').element;
    expect(wrapper.get('#preference-guide').attributes('aria-label')).toBe(
      'Show the new-project guide',
    );
    await wrapper.get('#preference-theme').setValue('dark');
    await wrapper.get('#preference-language').setValue('vi');
    expect(wrapper.text()).toContain('Save appearance');
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Đã lưu tùy chọn trình duyệt.'));
    expect(wrapper.text()).toContain('Ngoại tuyến');
    expect(wrapper.get('aside').attributes('aria-label')).toBe('Điều hướng trạm làm việc');
    expect(wrapper.get('#preference-guide').attributes('aria-label')).toBe(
      'Hiện hướng dẫn dự án mới',
    );
    expect(wrapper.get('#preference-theme').element).toHaveProperty('value', 'dark');
    expect(wrapper.get('#preference-theme').element).toBe(initial);
    expect(loadAppearance().language).toBe('vi');
    expect(wrapper.get('#preference-language').text()).toContain('English');
    await wrapper.get('#preference-language').setValue('en');
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() => expect(wrapper.text()).toContain('Browser preferences saved.'));
    expect(wrapper.get('#preference-guide').attributes('aria-label')).toBe(
      'Show the new-project guide',
    );
    wrapper.unmount();
  });

  it('applies Vietnamese for the session when storage rejects saving, and translates the stored notice on switch', async () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const appearance = shallowRef<AppearancePreferences>({ ...defaultAppearance });
    const Host = defineComponent({
      setup() {
        provideWorkstationLocale(computed(() => appearance.value.language));
        return () =>
          h(SettingsWorkspace, {
            daemonId: null,
            appearance: appearance.value,
            onAppearanceChanged: (value: AppearancePreferences) => {
              appearance.value = value;
            },
          });
      },
    });
    const wrapper = mount(Host);
    await flushPromises();
    await wrapper.get('#preference-language').setValue('vi');
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('Không thể sử dụng bộ nhớ trình duyệt.'),
    );
    expect(loadAppearance().language).toBe('en');
    appearance.value = { ...appearance.value, language: 'en' };
    await flushPromises();
    expect(wrapper.text()).toContain('Applied for this session. Browser storage is unavailable.');
    wrapper.unmount();
  });

  it('switches connection notices and validation while preserving an entered credential', async () => {
    const locale = shallowRef<WorkstationLocale>('en');
    const Host = defineComponent({
      setup() {
        provideWorkstationLocale(locale);
        return () =>
          h(ConnectionPanel, {
            state: {
              status: 'authentication',
              health: null,
              revision: 0,
              message: 'Credential expired or rejected; enter it again.',
            },
          });
      },
    });
    const wrapper = mount(Host);
    await flushPromises();
    await wrapper.get('#daemon-bearer').setValue('private-token');
    locale.value = 'vi';
    await flushPromises();
    expect(wrapper.text()).toContain(
      'Thông tin xác thực đã hết hạn hoặc bị từ chối; hãy nhập lại.',
    );
    expect(wrapper.get('#daemon-bearer').element).toHaveProperty('value', 'private-token');
    await wrapper.get('#daemon-bearer').setValue('');
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('Nhập thông tin xác thực bearer của daemon.'),
    );
    wrapper.unmount();
  });

  it('translates saved training notices at render time without resetting unsaved defaults', async () => {
    const locale = shallowRef<WorkstationLocale>('en');
    const Host = defineComponent({
      setup() {
        provideWorkstationLocale(locale);
        return () => h(TrainingDefaultsSettings, { daemonId: 'stable-daemon' });
      },
    });
    const wrapper = mount(Host);
    await flushPromises();
    await wrapper.get('[id$="-training-epochs"]').setValue('17');
    await wrapper.get('form').trigger('submit');
    await vi.waitFor(() =>
      expect(wrapper.text()).toContain('Defaults saved for new drafts on this daemon.'),
    );
    await wrapper.get('[id$="-training-epochs"]').setValue('29');
    locale.value = 'vi';
    await flushPromises();
    expect(wrapper.text()).toContain('Đã lưu mặc định cho bản nháp mới trên daemon này.');
    expect(wrapper.get('[id$="-training-epochs"]').element).toHaveProperty('value', '29');
    wrapper.unmount();
  });
});
