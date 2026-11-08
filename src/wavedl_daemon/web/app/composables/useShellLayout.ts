import {
  SHELL_PANEL_DEFAULT_WIDTH,
  SHELL_PANEL_MAX_WIDTH,
  SHELL_PANEL_MIN_WIDTH,
} from '../shell/constants';

import { sectionForPath } from '../shell/sections';
import type { ShellPanelTabDefinition, ShellPanelTabId, ShellLayoutState } from '~~/types/shell';

const shellRoutePathKey: InjectionKey<ComputedRef<string>> = Symbol('shell-route-path');

/** Resolves to the path the router actually landed on, which guards may change. */
type ShellNavigate = (path: string, preserveRun?: boolean) => Promise<string>;

const shellNavigateKey: InjectionKey<ShellNavigate> = Symbol('shell-navigate');

function clampPanelWidth(value: number): number {
  return Math.max(SHELL_PANEL_MIN_WIDTH, Math.min(SHELL_PANEL_MAX_WIDTH, Math.round(value)));
}

export function createShellLayoutState(
  routePath: MaybeRefOrGetter<string> = '/experiments',
): ShellLayoutState {
  const isPanelOpen = ref(true);
  /*
   * The docked desktop panel is a standing layout preference, so it starts open. The mobile
   * sheet is a modal the reader summons, and starting it open drops a scrim over the story
   * on every visit. One flag cannot serve both, so the sheet tracks its own explicit opens.
   */
  const hasSummonedPanel = ref(false);
  /*
   * Which of the two the reader is looking at. The dock and the sheet start in
   * opposite states, so a toggle cannot tell "open it" from "close it" without
   * knowing the mode: on a phone nothing is on screen and a press must open, on a
   * desktop the dock is already open and the same press must close. `layouts/shell.vue`
   * owns the only honest read of the viewport and publishes it here. It starts docked
   * because that is what the server renders.
   */
  const isDockedLayout = ref(true);
  const panelWidth = ref(SHELL_PANEL_DEFAULT_WIDTH);
  const isFocusMode = ref(false);
  const isCanvasExpanded = shallowRef(false);
  const activeTab = ref<ShellPanelTabId>('metrics');
  /*
   * Pages opt into the companion; an empty contribution leaves the canvas full-width.
   * Remember the chosen tab across routes without reserving space on other pages.
   */
  const panelTabs = shallowRef<readonly ShellPanelTabDefinition[]>([]);

  const isRailVisible = computed(() => !isFocusMode.value && !isCanvasExpanded.value);

  // A route without companion tabs must not reserve a blank docked column (or show a sheet).
  // Keep the open preference untouched so returning to a panel-capable route restores it.
  const isPanelVisible = computed(
    () => panelTabs.value.length > 0 && isPanelOpen.value && !isFocusMode.value,
  );

  const isPanelSheetVisible = computed(() => hasSummonedPanel.value && isPanelVisible.value);

  /** What the reader can actually see right now, whichever mode the shell is in. */
  const isCompanionShowing = computed(() =>
    isDockedLayout.value ? isPanelVisible.value : isPanelSheetVisible.value,
  );

  const resolvedActiveTab = computed(() => {
    const tabs = panelTabs.value;

    if (tabs.length === 0) return activeTab.value;

    if (tabs.some((tab) => tab.id === activeTab.value)) return activeTab.value;

    return tabs[0]?.id ?? activeTab.value;
  });

  /*
   * Containers exist for every registered tab so a page can teleport into them.
   * Bodies stay lazy: providers read this set and create content on first visit.
   */
  const visitedTabIds = reactive(new Set<ShellPanelTabId>());

  /*
   * Sync so a same-tick read after setActiveTab already sees the tab as visited.
   * The default pre flush is enough for templates, but providers and tests also
   * consult the set from the call that just selected the tab.
   */
  watch(
    [resolvedActiveTab, panelTabs],
    ([tabId, tabs]) => {
      if (tabs.some((tab) => tab.id === tabId)) visitedTabIds.add(tabId);
    },
    { immediate: true, flush: 'sync' },
  );

  const setCanvasExpanded = (expanded: boolean) => {
    isCanvasExpanded.value = expanded;
  };

  const toggleCanvasExpanded = () => {
    isCanvasExpanded.value = !isCanvasExpanded.value;
  };

  const enterFocusMode = () => {
    isFocusMode.value = true;
  };

  const exitFocusMode = () => {
    isFocusMode.value = false;
  };

  const toggleFocusMode = () => {
    isFocusMode.value = !isFocusMode.value;
  };

  /**
   * Open the companion where the reader left it. `setActiveTab` cannot serve this: it forces
   * a tab, and the mobile bar's companion slot must reopen on the tab already chosen.
   */
  const openPanel = () => {
    if (panelTabs.value.length === 0) return;
    isFocusMode.value = false;
    isPanelOpen.value = true;
    hasSummonedPanel.value = true;
  };

  /**
   * Dismiss the companion outright. The panel's own collapse control, the sheet's scrim and
   * Escape all mean "close", never "flip": they are only reachable while it is on screen, and
   * a toggle there would reopen it if the state ever disagreed with the chrome.
   */
  const closePanel = () => {
    isPanelOpen.value = false;
    hasSummonedPanel.value = false;
  };

  const setDockedLayout = (docked: boolean) => {
    isDockedLayout.value = docked;
  };

  const togglePanel = () => {
    if (panelTabs.value.length === 0) return;

    // Asking for the panel while immersed means you want it, not that you want
    // to toggle a preference you cannot currently see.
    if (isFocusMode.value) {
      openPanel();

      return;
    }

    /*
     * Flip what is on screen, not the dock's stored preference. `isPanelOpen` starts
     * true while the sheet starts un-summoned, so flipping the raw preference spent a
     * phone's very first press closing a panel the reader had never seen — and the
     * companion only appeared on the second.
     */
    if (isCompanionShowing.value) {
      closePanel();

      return;
    }

    openPanel();
  };

  const setPanelWidth = (value: number) => {
    if (!Number.isFinite(value)) return;
    panelWidth.value = clampPanelWidth(value);
  };

  const setActiveTab = (tab: ShellPanelTabId) => {
    if (!panelTabs.value.some((candidate) => candidate.id === tab)) return;
    activeTab.value = tab;
    isPanelOpen.value = true;
    isFocusMode.value = false;
    hasSummonedPanel.value = true;
  };

  const setPanelTabs = (tabs: readonly ShellPanelTabDefinition[]) => {
    panelTabs.value = tabs;

    if (tabs.length === 0) hasSummonedPanel.value = false;
  };

  const activeSection = computed(() => sectionForPath(toValue(routePath)));
  const commandPaletteOpen = shallowRef(false);

  const setRailVisible = (visible: boolean) => {
    isFocusMode.value = !visible;
  };

  return {
    activeSection,
    commandPaletteOpen,
    setRailVisible,
    isPanelOpen,
    isDockedLayout,
    panelWidth,
    isFocusMode,
    isCanvasExpanded,
    setCanvasExpanded,
    toggleCanvasExpanded,
    activeTab,
    panelTabs,
    resolvedActiveTab,
    visitedTabIds,
    isRailVisible,
    isPanelVisible,
    isPanelSheetVisible,
    isCompanionShowing,
    enterFocusMode,
    exitFocusMode,
    toggleFocusMode,
    togglePanel,
    openPanel,
    closePanel,
    setDockedLayout,
    setPanelWidth,
    setActiveTab,
    setPanelTabs,
  };
}

const sharedShellLayout = createShellLayoutState();

export function useShellLayout(): ShellLayoutState {
  const routePath = hasInjectionContext() ? inject(shellRoutePathKey, null) : null;

  if (!routePath) return sharedShellLayout;

  return {
    ...sharedShellLayout,
    activeSection: computed(() => sectionForPath(routePath.value)),
  };
}

export function provideShellRouting(routePath: ComputedRef<string>, navigate: ShellNavigate): void {
  provide(shellRoutePathKey, routePath);
  provide(shellNavigateKey, navigate);
}

export function useShellNavigation(): ShellNavigate | null {
  return hasInjectionContext() ? inject(shellNavigateKey, null) : null;
}

/** Register the tabs contributed by the currently visible section. */
export function useShellPanelTabs(
  tabs: MaybeRefOrGetter<readonly ShellPanelTabDefinition[]>,
): void {
  const layout = useShellLayout();
  const { isActive } = usePageActive();

  // Cached pages still react to run and connection changes while hidden. Only
  // the active page may replace the companion contribution, including on re-entry.
  watch(
    [isActive, () => toValue(tabs)],
    ([active, value]) => {
      if (active) layout.setPanelTabs(value);
    },
    { deep: true, immediate: true },
  );
}
