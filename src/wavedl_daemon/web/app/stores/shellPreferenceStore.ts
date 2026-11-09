import {
  loadShellDockSlots,
  saveShellDockSlots,
  loadShellSidebar,
  saveShellSidebar,
} from '../lib/preferences';
import {
  DEFAULT_SHELL_SIDEBAR,
  type StoredShellSidebar,
} from '../../shared/schemas/workstation-controls';
import { DEFAULT_SHELL_DOCK_SLOTS, normalizeShellDockSlots } from '../constants/shellDock';
import type { ShellDockSlots } from '~~/types/shell';

export const useShellPreferencesStore = defineStore('shellPreferences', () => {
  const storedDockSlots = shallowRef(loadShellDockSlots());
  const dockSlots = computed(() => storedDockSlots.value);
  const sidebar = shallowRef<StoredShellSidebar>(loadShellSidebar());
  const saveFailed = shallowRef(false);

  function updateSlots(next: ShellDockSlots): void {
    storedDockSlots.value = normalizeShellDockSlots(next);
    saveFailed.value = !saveShellDockSlots(storedDockSlots.value);
  }

  function toggleSidebarCollapsed(): void {
    sidebar.value = { ...sidebar.value, collapsed: !sidebar.value.collapsed };
    saveFailed.value = !saveShellSidebar(sidebar.value);
  }

  function setActiveRunsOpen(open: boolean): void {
    sidebar.value = { ...sidebar.value, activeRunsOpen: open };
    saveFailed.value = !saveShellSidebar(sidebar.value);
  }

  function reset(): void {
    updateSlots(DEFAULT_SHELL_DOCK_SLOTS);
    sidebar.value = { ...DEFAULT_SHELL_SIDEBAR };
    const sidebarSaved = saveShellSidebar(sidebar.value);
    saveFailed.value = !sidebarSaved || saveFailed.value;
  }

  function reload(): void {
    storedDockSlots.value = loadShellDockSlots();
    sidebar.value = loadShellSidebar();
    saveFailed.value = false;
  }

  return {
    dockSlots,
    sidebar,
    saveFailed,
    updateSlots,
    toggleSidebarCollapsed,
    setActiveRunsOpen,
    reset,
    reload,
  };
});
