import { Activity, ChartNoAxesCombined, Package, ScrollText, Settings2 } from '@lucide/vue';
import type { ShellPanelTabId, ShellPanelTabDefinition } from '~~/types/shell';

export const SHELL_PANEL_MIN_WIDTH = 320;
export const SHELL_PANEL_DEFAULT_WIDTH = 368;
export const SHELL_PANEL_MAX_WIDTH = 520;

export const SHELL_PANEL_TABS: readonly ShellPanelTabDefinition[] = [
  { id: 'metrics', labelKey: 'runs.tabMetrics', icon: ChartNoAxesCombined },
  { id: 'health', labelKey: 'runs.tabHealth', icon: Activity },
  { id: 'configuration', labelKey: 'runs.tabConfiguration', icon: Settings2 },
  { id: 'logs', labelKey: 'shell.logs', icon: ScrollText },
  { id: 'artifacts', labelKey: 'shell.artifacts', icon: Package },
];

export function shellPanelTabTargetId(tab: ShellPanelTabId): string {
  return `shell-panel-tab-${tab}`;
}
