// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick, readonly, shallowRef } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UpdatePrompt from '../../workstation/components/UpdatePrompt.vue';
import { provideWorkstationLocale } from '../../workstation/composables/useWorkstationI18n';
import type { WorkstationLocale } from '../../workstation/i18n/core';
import { UpdateConsent, type UpdateState } from '../../workstation/lib/update-consent';

const nuxt = vi.hoisted(() => ({ useNuxtApp: vi.fn() }));
vi.mock('#app', () => ({ useNuxtApp: nuxt.useNuxtApp }));

// This is an explicit component dependency mock, not a native service-worker test.
// Only Nuxt injection is replaced: policy, rendering, UI primitives and i18n are real.
function client(activate = vi.fn<() => Promise<void>>(async () => undefined)) {
  const state = shallowRef<UpdateState>({
    available: false,
    dismissed: false,
    updating: false,
    failed: false,
    installationRefusal: null,
  });
  const reload = vi.fn();
  const consent = new UpdateConsent({
    activate,
    reload,
    changed: (snapshot) => {
      state.value = snapshot;
    },
  });
  const injection = {
    state: readonly(state),
    approve: () => consent.approve(),
    defer: () => consent.defer(),
  };
  return { consent, activate, reload, injection };
}

const wrappers: VueWrapper[] = [];

function mountPrompt(
  tab: ReturnType<typeof client>,
  language = shallowRef<WorkstationLocale>('en'),
) {
  nuxt.useNuxtApp.mockReturnValue({ $workstationUpdate: tab.injection });
  const Provider = defineComponent({
    setup() {
      provideWorkstationLocale(language);
      return () => h(UpdatePrompt);
    },
  });
  const wrapper = mount(Provider);
  wrappers.push(wrapper);
  return wrapper;
}

beforeEach(() => {
  vi.useFakeTimers();
  nuxt.useNuxtApp.mockReset();
});

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('mounted workstation update prompt', () => {
  it.each([
    {
      reason: 'capacity' as const,
      en: 'Update blocked by retained offline builds. Existing tabs remain loaded. Close all Workstation tabs, then use browser storage tools to unregister only the WaveDL service-worker registration for this origin and remove only its retained-build caches and database. Reopen Workstation while connected.',
      vi: 'Cập nhật bị chặn do các bản dựng ngoại tuyến được giữ lại. Các thẻ hiện tại vẫn đang mở. Đóng tất cả các thẻ Workstation, rồi dùng công cụ lưu trữ của trình duyệt để chỉ hủy đăng ký service worker của WaveDL cho nguồn gốc này và chỉ xóa bộ nhớ đệm bản dựng được giữ lại cùng cơ sở dữ liệu của nó. Mở lại Workstation khi có kết nối.',
    },
    {
      reason: 'verification' as const,
      en: 'Update verification failed. This tab has not reloaded. Restore the connection and reload explicitly to check again.',
      vi: 'Xác minh bản cập nhật thất bại. Thẻ này chưa được tải lại. Khôi phục kết nối rồi chủ động tải lại để kiểm tra lần nữa.',
    },
  ])(
    'shows $reason refusal without a misleading retry action in EN/VI',
    async ({ reason, en, vi: vietnamese }) => {
      const tab = client();
      const language = shallowRef<WorkstationLocale>('en');
      const wrapper = mountPrompt(tab, language);
      // Refusal may arrive without any SDK waiting callback.
      tab.consent.installationRefused(reason);
      await nextTick();
      expect(wrapper.get('[data-slot="alert-description"]').text()).toBe(en);
      expect(wrapper.findAll('button').map((button) => button.text())).toEqual(['Later']);
      expect(wrapper.find('p[role="alert"]').exists()).toBe(false);
      const refused = tab.consent.snapshot();
      language.value = 'vi';
      await nextTick();
      expect(wrapper.get('[data-slot="alert-description"]').text()).toBe(vietnamese);
      expect(wrapper.findAll('button').map((button) => button.text())).toEqual(['Để sau']);
      expect(tab.consent.snapshot()).toBe(refused);
      await tab.injection.approve();
      expect(tab.activate).not.toHaveBeenCalled();
      expect(tab.reload).not.toHaveBeenCalled();
      await wrapper.get('button').trigger('click');
      expect(wrapper.find('[data-slot="alert"]').exists()).toBe(false);
      tab.consent.available();
      await nextTick();
      expect(wrapper.get('button:first-child').text()).toBe('Cập nhật và tải lại');
      expect(wrapper.text()).not.toContain(vietnamese);
      await wrapper.get('button:first-child').trigger('click');
      await flushPromises();
      expect(tab.activate).toHaveBeenCalledOnce();
      expect(tab.reload).not.toHaveBeenCalled();
      tab.consent.controlled();
      expect(tab.reload).toHaveBeenCalledOnce();
    },
  );

  it('replaces pending approval with installation-refusal feedback and never reloads on later takeover', async () => {
    const tab = client();
    const wrapper = mountPrompt(tab);
    tab.consent.available();
    await nextTick();
    await wrapper.get('button:first-child').trigger('click');
    await flushPromises();
    tab.consent.installationRefused('capacity');
    tab.consent.controlled();
    await nextTick();
    expect(wrapper.text()).toContain('Update blocked by retained offline builds.');
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual(['Later']);
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(tab.activate).toHaveBeenCalledOnce();
    expect(tab.reload).not.toHaveBeenCalled();
  });

  it('renders nothing until an update is available and Later dismisses without activation or reload', async () => {
    const tab = client();
    const wrapper = mountPrompt(tab);
    expect(wrapper.find('[data-slot="alert"]').exists()).toBe(false);
    expect(wrapper.findAll('button')).toHaveLength(0);

    tab.consent.available();
    await nextTick();
    expect(wrapper.get('[data-slot="alert"]').attributes('role')).toBe('alert');
    expect(wrapper.text()).toContain('A workstation update is available');
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual([
      'Update and reload',
      'Later',
    ]);
    expect(wrapper.findAll('[data-slot="button"]')).toHaveLength(2);

    await wrapper.get('button:last-child').trigger('click');
    expect(wrapper.find('[data-slot="alert"]').exists()).toBe(false);
    expect(tab.consent.snapshot()).toMatchObject({ available: true, dismissed: true });
    expect(tab.activate).not.toHaveBeenCalled();
    expect(tab.reload).not.toHaveBeenCalled();
  });

  it('reopens a deferred tab after another client takes control, and only reloads each approving client once', async () => {
    const a = client();
    const b = client();
    const first = mountPrompt(a);
    const second = mountPrompt(b);
    a.consent.available();
    b.consent.available();
    await nextTick();
    await second.get('button:last-child').trigger('click');
    await first.get('button:first-child').trigger('click');
    await flushPromises();
    expect(a.activate).toHaveBeenCalledOnce();
    expect(a.reload).not.toHaveBeenCalled();
    expect(b.activate).not.toHaveBeenCalled();
    expect(b.reload).not.toHaveBeenCalled();

    // Model the shared worker's takeover callback for both independent clients.
    a.consent.controlled();
    b.consent.controlled();
    await nextTick();
    expect(first.find('[data-slot="alert"]').exists()).toBe(false);
    expect(a.reload).toHaveBeenCalledOnce();
    expect(second.get('button:first-child').text()).toBe('Update and reload');
    expect(b.reload).not.toHaveBeenCalled();

    await second.get('button:first-child').trigger('click');
    expect(b.activate).not.toHaveBeenCalled();
    expect(b.reload).toHaveBeenCalledOnce();
    expect(second.find('[data-slot="alert"]').exists()).toBe(false);
    a.consent.controlled();
    b.consent.controlled();
    await a.injection.approve();
    await b.injection.approve();
    expect(a.reload).toHaveBeenCalledOnce();
    expect(b.reload).toHaveBeenCalledOnce();
  });

  it('disables both real buttons and shows Updating until takeover, not merely request completion', async () => {
    let finish: (() => void) | undefined;
    const tab = client(
      vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const wrapper = mountPrompt(tab);
    tab.consent.available();
    await nextTick();
    await wrapper.get('button:first-child').trigger('click');
    expect(wrapper.get('button:first-child').text()).toBe('Updating…');
    for (const button of wrapper.findAll('button')) {
      expect(button.attributes('disabled')).toBeDefined();
      await button.trigger('click');
    }
    expect(tab.activate).toHaveBeenCalledOnce();
    expect(tab.consent.snapshot().dismissed).toBe(false);
    expect(tab.reload).not.toHaveBeenCalled();

    finish?.();
    await flushPromises();
    expect(wrapper.get('button:first-child').text()).toBe('Updating…');
    expect(
      wrapper.findAll('button').every((button) => button.attributes('disabled') !== undefined),
    ).toBe(true);
    expect(tab.reload).not.toHaveBeenCalled();
    tab.consent.controlled();
    await nextTick();
    expect(tab.reload).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-slot="alert"]').exists()).toBe(false);
  });

  it('shows activation failure and enables a fresh explicit retry without prematurely reloading', async () => {
    const activate = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    const tab = client(activate);
    const language = shallowRef<WorkstationLocale>('en');
    const wrapper = mountPrompt(tab, language);
    tab.consent.available();
    await nextTick();
    await wrapper.get('button:first-child').trigger('click');
    await flushPromises();
    expect(wrapper.get('p[role="alert"]').text()).toBe(
      'The update failed. Try again when connected.',
    );
    expect(wrapper.get('button:first-child').text()).toBe('Update and reload');
    expect(
      wrapper.findAll('button').every((button) => button.attributes('disabled') === undefined),
    ).toBe(true);
    expect(tab.reload).not.toHaveBeenCalled();

    const failed = tab.consent.snapshot();
    language.value = 'vi';
    await nextTick();
    expect(wrapper.get('p[role="alert"]').text()).toBe(
      'Cập nhật thất bại. Hãy thử lại khi có kết nối.',
    );
    expect(wrapper.get('button:first-child').text()).toBe('Cập nhật và tải lại');
    expect(tab.consent.snapshot()).toBe(failed);

    await wrapper.get('button:first-child').trigger('click');
    await flushPromises();
    expect(activate).toHaveBeenCalledTimes(2);
    expect(wrapper.find('p[role="alert"]').exists()).toBe(false);
    expect(wrapper.get('button:first-child').text()).toBe('Đang cập nhật…');
    expect(tab.reload).not.toHaveBeenCalled();
    tab.consent.controlled();
    await nextTick();
    expect(tab.reload).toHaveBeenCalledOnce();
  });

  it('reactively translates EN/VI without remounting or resetting pending and deferred consent', async () => {
    const tab = client();
    const language = shallowRef<WorkstationLocale>('en');
    const wrapper = mountPrompt(tab, language);
    const prompt = wrapper.getComponent(UpdatePrompt).vm.$;
    tab.consent.available();
    await nextTick();
    const available = tab.consent.snapshot();
    language.value = 'vi';
    await nextTick();
    expect(wrapper.text()).toContain('Có bản cập nhật trạm làm việc');
    expect(wrapper.text()).toContain('Chỉ tải lại thẻ này khi bạn sẵn sàng.');
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual([
      'Cập nhật và tải lại',
      'Để sau',
    ]);
    expect(tab.consent.snapshot()).toBe(available);

    await wrapper.get('button:last-child').trigger('click');
    const deferred = tab.consent.snapshot();
    language.value = 'en';
    await nextTick();
    expect(tab.consent.snapshot()).toBe(deferred);
    expect(wrapper.find('[data-slot="alert"]').exists()).toBe(false);
    expect(tab.activate).not.toHaveBeenCalled();
    expect(tab.reload).not.toHaveBeenCalled();

    tab.consent.available();
    await nextTick();
    await wrapper.get('button:first-child').trigger('click');
    await flushPromises();
    const pending = tab.consent.snapshot();
    language.value = 'vi';
    await nextTick();
    expect(wrapper.get('button:first-child').text()).toBe('Đang cập nhật…');
    expect(tab.consent.snapshot()).toBe(pending);
    expect(wrapper.getComponent(UpdatePrompt).vm.$).toBe(prompt);
    expect(tab.activate).toHaveBeenCalledOnce();
    expect(tab.reload).not.toHaveBeenCalled();
    tab.consent.controlled();
    await nextTick();
    expect(tab.reload).toHaveBeenCalledOnce();
  });
});
