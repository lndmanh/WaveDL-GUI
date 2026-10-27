import type { Component } from 'vue';

/**
 * Section integration contract:
 * - The controller retains section instances; activeSection is the visible canvas.
 * - Teleport run logs to #shell-panel-tab-logs and results to
 *   #shell-panel-tab-artifacts. Both targets stay mounted while the panel is closed.
 * - Use Teleport's `defer` (or wait for onMounted) because targets are siblings of
 *   the canvas. Gate teleported bodies by activeSection, not the section's v-show.
 * - useShellLayout().setActiveTab('logs' | 'artifacts') selects and opens a tab;
 *   useShellPanelTabs() can register a section-specific subset of the real tabs.
 * - WorkstationShell exposes an `actions` slot beside its Experiments Adopt action.
 *   Connection, Settings and Adopt are overlays, never canvas destinations.
 */
import { FileChartColumn, Layers, Database, Plus, Cable, Settings2, Import } from '@lucide/vue';
import {
  WORKSTATION_SECTIONS,
  type PrimaryWorkstationSection,
  type WorkstationSection,
} from '../lib/shell-test-ids';

export type { PrimaryWorkstationSection, WorkstationSection };

export type ShellCommand = 'adopt' | 'connection' | 'settings';

export interface ShellNavigationDescriptor {
  id: WorkstationSection;
  labelKey: string;
  icon: Component;
  command?: ShellCommand;
}

export const SHELL_PRIMARY_NAVIGATION: readonly ShellNavigationDescriptor[] = [
  {
    id: WORKSTATION_SECTIONS.experiments,
    labelKey: 'shell.experiments',
    icon: Layers,
  },
  {
    id: WORKSTATION_SECTIONS.project,
    labelKey: 'shell.newTrainingRun',
    icon: Plus,
  },
  {
    id: WORKSTATION_SECTIONS.datasets,
    labelKey: 'shell.datasets',
    icon: Database,
  },
  {
    id: WORKSTATION_SECTIONS.results,
    labelKey: 'shell.results',
    icon: FileChartColumn,
  },
] as const;

export const SHELL_ACTION_NAVIGATION: readonly ShellNavigationDescriptor[] = [
  {
    id: WORKSTATION_SECTIONS.adopt,
    labelKey: 'shell.adoptStandaloneRun',
    icon: Import,
    command: 'adopt',
  },
  {
    id: WORKSTATION_SECTIONS.connection,
    labelKey: 'shell.connection',
    icon: Cable,
    command: 'connection',
  },
  {
    id: WORKSTATION_SECTIONS.settings,
    labelKey: 'shell.settings',
    icon: Settings2,
    command: 'settings',
  },
] as const;
