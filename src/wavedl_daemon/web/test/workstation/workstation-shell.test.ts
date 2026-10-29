// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
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
import { provideShellRouting } from '../../app/composables/useShellLayout';
import { sectionForPath, sectionPath } from '../../app/shell/sections';

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
    expect(wrapper.emitted('navigate')).toContainEqual(['settings']);
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
        ['experiments', 'project', 'datasets', 'results', 'connection', 'settings'].map((section) => [section]),
      );
      expect(shell.emitted('update:overlay')).toEqual(
        expect.arrayContaining([['adopt']]),
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

  it.each([
    ['/experiments', 'adopt'],
    ['/login?next=%2Fexperiments', null],
  ])('opens adoption only once navigation lands on Experiments (%s), despite a lagging rendered route', async (landed, expected) => {
    // Nuxt updates the layout's rendered route after the router resolves, as here.
    const renderedPath = shallowRef('/datasets');
    const overlay = shallowRef<'adopt' | null>(null);
    const navigations: string[] = [];
    const Host = defineComponent({
      setup() {
        provideShellRouting(
          computed(() => renderedPath.value),
          async (nextPath) => {
            navigations.push(nextPath);
            const landedPath = landed.split('?')[0] ?? landed;
            setTimeout(() => { renderedPath.value = landedPath; }, 0);
            return landedPath;
          },
        );
        return () =>
          h(WorkstationShell, {
            status: 'connected',
            section: sectionForPath(renderedPath.value),
            overlay: overlay.value,
            'onUpdate:overlay': (value) => (overlay.value = value),
          });
      },
    });
    const wrapper = mount(Host);
    const palette = wrapper.getComponent({ name: 'ShellCommandPalette' });
    palette.vm.$emit('navigate', 'adopt');
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigations).toEqual(['/experiments']);
    expect(overlay.value).toBe(expected);
    wrapper.unmount();
  });

  it('routes primary navigation, connection and settings and only overlays adoption', async () => {
    const path = shallowRef('/experiments');
    const overlay = shallowRef<'adopt' | null>(null);
    const navigations: string[] = [];
    const Host = defineComponent({
      setup() {
        provideShellRouting(
          computed(() => path.value),
          async (nextPath) => {
            navigations.push(nextPath);
            path.value = nextPath;
            return nextPath;
          },
        );
        return () =>
          h(WorkstationShell, {
            status: 'disconnected',
            section: sectionForPath(path.value),
            overlay: overlay.value,
            'onUpdate:overlay': (value) => (overlay.value = value),
          });
      },
    });
    const wrapper = mount(Host);
    const shell = wrapper.getComponent(WorkstationShell);

    await wrapper.get(`[data-testid="${workstationNavTestId('datasets')}"]`).trigger('click');
    expect(navigations).toEqual(['/datasets']);
    expect(sectionPath('project')).toBe('/new');
    expect(
      wrapper
        .get(`[data-testid="${workstationNavTestId('datasets')}"]`)
        .attributes('aria-current'),
    ).toBe('page');

    await wrapper.get(`[data-testid="${workstationNavTestId('connection')}"]`).trigger('click');
    expect(overlay.value).toBeNull();
    expect(navigations).toEqual(['/datasets', '/login']);
    expect(wrapper.get('[data-testid="nav-connection"]').attributes('aria-current')).toBe('page');

    await wrapper.get(`[data-testid="${workstationNavTestId('settings')}"]`).trigger('click');
    expect(overlay.value).toBeNull();
    expect(navigations).toEqual(['/datasets', '/login', '/settings']);
    expect(wrapper.get('[data-testid="nav-settings"]').attributes('aria-current')).toBe('page');
    expect(shell.emitted('navigate')).toBeUndefined();
    wrapper.unmount();
  });
});
