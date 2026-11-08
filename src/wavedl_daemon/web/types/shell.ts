import type { ComputedRef, Ref, Component } from 'vue';
import type {
  WORKSTATION_SECTIONS,
  PRIMARY_WORKSTATION_SECTION_IDS,
} from '../app/lib/shell-test-ids';

export interface ShellLayoutState {
  activeSection: ComputedRef<WorkstationSection>;
  isRailVisible: ComputedRef<boolean>;
  isFocusMode: Ref<boolean>;
  isCanvasExpanded: Ref<boolean>;
  setCanvasExpanded(expanded: boolean): void;
  toggleCanvasExpanded(): void;
  isPanelSheetVisible: ComputedRef<boolean>;
  isCompanionShowing: ComputedRef<boolean>;
  resolvedActiveTab: ComputedRef<ShellPanelTabId>;
  visitedTabIds: Set<ShellPanelTabId>;
  enterFocusMode(): void;
  exitFocusMode(): void;
  toggleFocusMode(): void;
  isPanelOpen: Ref<boolean>;
  isPanelVisible: ComputedRef<boolean>;
  isDockedLayout: Ref<boolean>;
  panelTabs: Ref<readonly ShellPanelTabDefinition[]>;
  activeTab: Ref<ShellPanelTabId>;
  panelWidth: Ref<number>;
  commandPaletteOpen: Ref<boolean>;
  setRailVisible(visible: boolean): void;
  setDockedLayout(docked: boolean): void;
  setPanelTabs(tabs: readonly ShellPanelTabDefinition[]): void;
  setActiveTab(tab: ShellPanelTabId): void;
  setPanelWidth(width: number): void;
  openPanel(): void;
  closePanel(): void;
  togglePanel(): void;
}

export type ShellScrollTarget = Window | HTMLElement;

export type ShellDockSlots = [
  WorkstationSection,
  WorkstationSection,
  WorkstationSection,
  WorkstationSection,
  WorkstationSection,
];

export type WorkstationSection = (typeof WORKSTATION_SECTIONS)[keyof typeof WORKSTATION_SECTIONS];

export type PrimaryWorkstationSection = (typeof PRIMARY_WORKSTATION_SECTION_IDS)[number];

export type ShellPanelTabId = 'metrics' | 'health' | 'configuration' | 'logs' | 'artifacts';

export interface ShellPanelTabDefinition {
  id: ShellPanelTabId;
  labelKey: string;
  icon: Component;
}

export type ShellCommand = 'connection' | 'settings';

export interface ShellNavigationDescriptor<
  Section extends WorkstationSection = WorkstationSection,
> {
  id: Section;
  labelKey: string;
  icon: Component;
  path: string;
  command?: ShellCommand;
}
