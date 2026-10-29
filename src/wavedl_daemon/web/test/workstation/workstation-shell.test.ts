// @vitest-environment happy-dom
import { mountWithI18n as mount } from './mountWithI18n';
import { computed, defineComponent, h, shallowRef } from 'vue';
import { describe, expect, it } from 'vitest';
import WorkstationShell from '../../app/components/shell/WorkstationShell.vue';
import { provideWorkstationLocale } from '../../app/composables/useWorkstationI18n';
import type { WorkstationLocale } from '../../app/i18n/core';
import {
  WORKSTATION_SECTION_IDS,
  WORKSTATION_SHELL_TEST_IDS,
  workstationNavTestId,
} from '../../app/lib/shell-test-ids';

describe('workstation navigation', () => {
  it('offers all implemented destinations without requiring daemon authentication', async () => {
    const wrapper = mount(WorkstationShell, {
      props: { status: 'disconnected', section: 'experiments', overlay: null },
    });
    const navigation = wrapper.get(`[data-testid="${WORKSTATION_SHELL_TEST_IDS.navigation}"]`);
    for (const section of WORKSTATION_SECTION_IDS) {
      const control = wrapper.get(`[data-testid="${workstationNavTestId(section)}"]`);
      expect(control.attributes('disabled')).toBeUndefined();
      expect(control.attributes('aria-label') || control.text()).not.toBe('');
    }
    expect(navigation.find(`[data-testid="${workstationNavTestId('adopt')}"]`).exists()).toBe(
      false,
    );
    await navigation.get(`[data-testid="${workstationNavTestId('settings')}"]`).trigger('click');
    expect(wrapper.emitted('update:overlay')).toContainEqual(['settings']);
    wrapper.unmount();
  });

  it('keeps navigation test ids stable while localizing the accessible section name', async () => {
    for (const locale of ['en', 'vi'] as const) {
      const language = shallowRef<WorkstationLocale>(locale);
      const Host = defineComponent({
        setup() {
          provideWorkstationLocale(computed(() => language.value));
          return () =>
            h(WorkstationShell, {
              status: 'disconnected',
              section: 'experiments',
              overlay: null,
            });
        },
      });
      const wrapper = mount(Host);
      const shell = wrapper.getComponent(WorkstationShell);
      const navigation = wrapper.get(`[data-testid="${WORKSTATION_SHELL_TEST_IDS.navigation}"]`);

      expect(navigation.attributes('aria-label')).toBe(locale === 'en' ? 'Sections' : 'Các mục');
      for (const section of WORKSTATION_SECTION_IDS) {
        const selector = `[data-testid="${workstationNavTestId(section)}"]`;
        expect(wrapper.findAll(selector)).toHaveLength(1);
        expect(wrapper.get(selector).exists()).toBe(true);
      }
      expect(
        navigation
          .get(`[data-testid="${workstationNavTestId('experiments')}"]`)
          .attributes('aria-current'),
      ).toBe('page');
      expect(
        navigation
          .get(`[data-testid="${workstationNavTestId('settings')}"]`)
          .attributes('aria-current'),
      ).toBeUndefined();
      for (const section of WORKSTATION_SECTION_IDS) {
        await wrapper.get(`[data-testid="${workstationNavTestId(section)}"]`).trigger('click');
      }
      expect(shell.emitted('navigate')).toEqual(
        ['experiments', 'project', 'datasets', 'results'].map((section) => [section]),
      );
      expect(shell.emitted('update:overlay')).toEqual(
        expect.arrayContaining([['adopt'], ['connection'], ['settings']]),
      );
      expect(wrapper.get(`[data-testid="${WORKSTATION_SHELL_TEST_IDS.content}"]`).exists()).toBe(
        true,
      );
      expect(
        wrapper.get(`[data-testid="${WORKSTATION_SHELL_TEST_IDS.connectionStatus}"]`).exists(),
      ).toBe(true);
      wrapper.unmount();
    }
  });
});
