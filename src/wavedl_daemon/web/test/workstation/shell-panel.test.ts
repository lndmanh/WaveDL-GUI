// @vitest-environment happy-dom
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mountWithI18n as mountWithMessages } from './mountWithI18n';
import ShellCompanion from '../../app/components/shell/ShellCompanion.vue';
import ShellPanel from '../../app/components/shell/ShellPanel.vue';
import WorkstationShell from '../../app/components/shell/WorkstationShell.vue';
import {
  SHELL_PANEL_DEFAULT_WIDTH,
  SHELL_PANEL_MAX_WIDTH,
  SHELL_PANEL_MIN_WIDTH,
  SHELL_PANEL_TABS,
} from '../../app/shell/constants';
import { useShellLayout } from '../../app/composables/useShellLayout';

const layout = useShellLayout();
const initialViewportWidth = window.innerWidth;
const mountedWrappers: Array<{ unmount: () => void }> = [];

async function settle(): Promise<void> {
  await nextTick();
  await flushPromises();
  await nextTick();
}

function resetLayout(): void {
  layout.setRailVisible(true);
  layout.setDockedLayout(true);
  layout.setPanelTabs(SHELL_PANEL_TABS);
  layout.setActiveTab('logs');
  layout.setPanelWidth(SHELL_PANEL_DEFAULT_WIDTH);
  layout.openPanel();
}

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount();
  document.body.innerHTML = '';
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: initialViewportWidth,
  });
  resetLayout();
});

describe('shell companion layout', () => {
  it('shares singleton state and clamps the companion width to 320–520px', () => {
    const sameLayout = useShellLayout();

    expect(sameLayout).toBe(layout);
    expect(layout.panelWidth.value).toBe(SHELL_PANEL_DEFAULT_WIDTH);
    expect(sameLayout.activeSection.value).toBe('experiments');

    layout.setPanelWidth(SHELL_PANEL_MIN_WIDTH - 1);
    expect(layout.panelWidth.value).toBe(SHELL_PANEL_MIN_WIDTH);
    layout.setPanelWidth(SHELL_PANEL_MAX_WIDTH + 1);
    expect(layout.panelWidth.value).toBe(SHELL_PANEL_MAX_WIDTH);
    layout.setPanelWidth(401);
    expect(layout.panelWidth.value).toBe(401);
  });

  it('resizes through the keyboard and applies bounds in the host layout', async () => {
    resetLayout();
    const Host = defineComponent({
      setup() {
        return () =>
          h(ShellPanel, {
            tabs: layout.panelTabs.value,
            activeTab: layout.activeTab.value,
            width: layout.panelWidth.value,
            onResize: layout.setPanelWidth,
            onUpdateActiveTab: layout.setActiveTab,
          });
      },
    });
    const wrapper = mountWithMessages(Host, { attachTo: document.body });
    mountedWrappers.push(wrapper);
    const handle = wrapper.get('[role="separator"]');

    await handle.trigger('keydown', { key: 'ArrowLeft' });
    expect(layout.panelWidth.value).toBe(SHELL_PANEL_DEFAULT_WIDTH + 24);
    await handle.trigger('keydown', { key: 'ArrowRight' });
    expect(layout.panelWidth.value).toBe(SHELL_PANEL_DEFAULT_WIDTH);
    await handle.trigger('keydown', { key: 'ArrowLeft' });
    expect(layout.panelWidth.value).toBe(SHELL_PANEL_DEFAULT_WIDTH + 24);
    await handle.trigger('keydown', { key: 'Home' });
    expect(layout.panelWidth.value).toBe(SHELL_PANEL_DEFAULT_WIDTH);

    layout.setPanelWidth(SHELL_PANEL_MIN_WIDTH);
    await settle();
    await handle.trigger('keydown', { key: 'ArrowRight' });
    expect(layout.panelWidth.value).toBe(SHELL_PANEL_MIN_WIDTH);
    layout.setPanelWidth(SHELL_PANEL_MAX_WIDTH);
    await settle();
    await handle.trigger('keydown', { key: 'ArrowLeft' });
    expect(layout.panelWidth.value).toBe(SHELL_PANEL_MAX_WIDTH);

    await settle();
    expect(wrapper.get('[role="separator"]').attributes('aria-valuemin')).toBe(
      String(SHELL_PANEL_MIN_WIDTH),
    );
    expect(wrapper.get('[role="separator"]').attributes('aria-valuemax')).toBe(
      String(SHELL_PANEL_MAX_WIDTH),
    );
  });

  it('keeps both tab targets mounted while switching tabs and closing the panel', async () => {
    resetLayout();
    const wrapper = mountWithMessages(ShellCompanion, {
      attachTo: document.body,
      slots: {
        logs: '<p data-testid="logs-content">Run logs</p>',
        artifacts: '<p data-testid="artifacts-content">Artifacts</p>',
      },
    });
    mountedWrappers.push(wrapper);
    await settle();

    const logsTarget = wrapper.get('#shell-panel-tab-logs');
    const artifactsTarget = wrapper.get('#shell-panel-tab-artifacts');
    expect(logsTarget.exists()).toBe(true);
    expect(artifactsTarget.exists()).toBe(true);
    expect(logsTarget.text()).toContain('Run logs');
    expect(artifactsTarget.text()).toContain('Artifacts');

    const tabs = wrapper.findAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.attributes('aria-selected')).toBe('true');
    await tabs[0]?.trigger('keydown', { key: 'ArrowRight' });
    await settle();
    expect(layout.activeTab.value).toBe('artifacts');
    expect(tabs[1]?.attributes('aria-selected')).toBe('true');
    expect(wrapper.get('#shell-panel-tab-logs').exists()).toBe(true);
    expect(wrapper.get('#shell-panel-tab-artifacts').exists()).toBe(true);

    layout.closePanel();
    await settle();
    expect(wrapper.get('#shell-panel-tab-logs').exists()).toBe(true);
    expect(wrapper.get('#shell-panel-tab-artifacts').exists()).toBe(true);
    expect(wrapper.get('#shell-companion').attributes('style')).toContain('display: none');
  });

  it('traps focus in the mobile companion and returns it to the opener on Escape', async () => {
    resetLayout();
    layout.closePanel();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const wrapper = mountWithMessages(WorkstationShell, {
      props: { status: 'disconnected', section: 'experiments', overlay: null },
      attachTo: document.body,
      slots: {
        logs: '<button data-testid="mobile-log-control">Log action</button>',
        artifacts: '<p>Artifacts</p>',
      },
    });
    mountedWrappers.push(wrapper);
    const opener = wrapper.get('button[aria-label="Open companion panel"]');
    opener.element.focus();
    expect(document.activeElement).toBe(opener.element);
    await opener.trigger('click');
    await settle();

    const panel = wrapper.get('#shell-companion');
    expect(panel.attributes('role')).toBe('dialog');
    expect(panel.attributes('aria-modal')).toBe('true');
    expect(panel.element.contains(document.activeElement)).toBe(true);
    expect(wrapper.find('.shell-panel-scrim').exists()).toBe(true);

    await panel.trigger('keydown', { key: 'Escape' });
    await settle();
    expect(layout.isPanelVisible.value).toBe(false);
    expect(document.activeElement).toBe(opener.element);
    expect(wrapper.find('.shell-panel-scrim').exists()).toBe(false);
  });
});
