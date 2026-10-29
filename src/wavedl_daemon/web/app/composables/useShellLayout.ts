import {
  computed,
  onActivated,
  onMounted,
  shallowRef,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type ComputedRef,
  type Ref,
} from 'vue';
import {
  SHELL_PANEL_DEFAULT_WIDTH,
  SHELL_PANEL_MAX_WIDTH,
  SHELL_PANEL_MIN_WIDTH,
  SHELL_PANEL_TABS,
  type ShellPanelTabDefinition,
  type ShellPanelTabId,
} from '../shell/constants';
import type { PrimaryWorkstationSection } from '../lib/shell-test-ids';

export type { ShellPanelTabDefinition, ShellPanelTabId } from '../shell/constants';

function clampPanelWidth(value: number): number {
  return Math.max(SHELL_PANEL_MIN_WIDTH, Math.min(SHELL_PANEL_MAX_WIDTH, Math.round(value)));
}

export interface ShellLayoutState {
  activeSection: Ref<PrimaryWorkstationSection>;
  isRailVisible: Ref<boolean>;
  isPanelOpen: Ref<boolean>;
  isPanelVisible: ComputedRef<boolean>;
  isDockedLayout: Ref<boolean>;
  panelTabs: Ref<readonly ShellPanelTabDefinition[]>;
  activeTab: Ref<ShellPanelTabId>;
  panelWidth: Ref<number>;
  commandPaletteOpen: Ref<boolean>;
  setActiveSection(section: PrimaryWorkstationSection): void;
  setRailVisible(visible: boolean): void;
  setDockedLayout(docked: boolean): void;
  setPanelTabs(tabs: readonly ShellPanelTabDefinition[]): void;
  setActiveTab(tab: ShellPanelTabId): void;
  setPanelWidth(width: number): void;
  openPanel(): void;
  closePanel(): void;
  togglePanel(): void;
}

export function createShellLayoutState(): ShellLayoutState {
  const activeSection = shallowRef<PrimaryWorkstationSection>('experiments');
  const isRailVisible = shallowRef(true);
  const isPanelOpen = shallowRef(true);
  const isDockedLayout = shallowRef(true);
  const panelTabs = shallowRef<readonly ShellPanelTabDefinition[]>(SHELL_PANEL_TABS);
  const activeTab = shallowRef<ShellPanelTabId>('logs');
  const panelWidth = shallowRef(SHELL_PANEL_DEFAULT_WIDTH);
  const commandPaletteOpen = shallowRef(false);
  const isPanelVisible = computed(() => isPanelOpen.value && panelTabs.value.length > 0);

  function setActiveSection(section: PrimaryWorkstationSection): void {
    activeSection.value = section;
  }

  function setRailVisible(visible: boolean): void {
    isRailVisible.value = visible;
  }

  function setDockedLayout(docked: boolean): void {
    isDockedLayout.value = docked;
    if (docked) return;
    // Mobile companion panels are summoned rather than permanently reserved.
    isPanelOpen.value = false;
  }

  function setPanelTabs(tabs: readonly ShellPanelTabDefinition[]): void {
    panelTabs.value = tabs;
    if (!tabs.some((tab) => tab.id === activeTab.value)) {
      activeTab.value = tabs[0]?.id ?? 'logs';
    }
  }

  function setActiveTab(tab: ShellPanelTabId): void {
    if (!panelTabs.value.some((candidate) => candidate.id === tab)) return;
    activeTab.value = tab;
    isPanelOpen.value = true;
  }

  function setPanelWidth(width: number): void {
    panelWidth.value = clampPanelWidth(width);
  }

  function openPanel(): void {
    isPanelOpen.value = true;
  }

  function closePanel(): void {
    isPanelOpen.value = false;
  }

  function togglePanel(): void {
    isPanelOpen.value = !isPanelOpen.value;
  }

  return {
    activeSection,
    isRailVisible,
    isPanelOpen,
    isPanelVisible,
    isDockedLayout,
    panelTabs,
    activeTab,
    panelWidth,
    commandPaletteOpen,
    setActiveSection,
    setRailVisible,
    setDockedLayout,
    setPanelTabs,
    setActiveTab,
    setPanelWidth,
    openPanel,
    closePanel,
    togglePanel,
  };
}

const sharedShellLayout = createShellLayoutState();

export function useShellLayout(): ShellLayoutState {
  return sharedShellLayout;
}

/** Register the tabs contributed by the currently visible section. */
export function useShellPanelTabs(
  tabs: MaybeRefOrGetter<readonly ShellPanelTabDefinition[]>,
): void {
  const layout = useShellLayout();
  const apply = () => layout.setPanelTabs(toValue(tabs));
  onMounted(apply);
  onActivated(apply);
  watch(() => toValue(tabs), apply, { deep: true, immediate: true });
}
