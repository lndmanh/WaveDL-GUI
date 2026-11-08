import { isUuid } from '../../shared/schemas/daemon-api';

/**
 * Section integration contract:
 * - The router selects the active work page; activeSection is derived from its path.
 * - A selected Experiments run contributes companion tabs through ShellPage.panelTabs;
 *   other pages contribute none. useShellLayout().setActiveTab() selects and opens a tab.
 * - shellPanelTabTargetId() names permanent teleport targets, even while the panel is
 *   closed. Use Teleport's `defer` (or wait for onMounted) because the targets are
 *   siblings of the canvas. Park teleported content when usePageActive() is inactive.
 * - Connection and Settings are pages.
 */
import { FileChartColumn, Layers, Database, Plus, Cable, Settings2 } from '@lucide/vue';
import { WORKSTATION_SECTIONS } from '../lib/shell-test-ids';
import type {
  PrimaryWorkstationSection,
  WorkstationSection,
  ShellNavigationDescriptor,
} from '~~/types/shell';

export const SHELL_PRIMARY_NAVIGATION: readonly ShellNavigationDescriptor<PrimaryWorkstationSection>[] =
  [
    {
      id: WORKSTATION_SECTIONS.experiments,
      labelKey: 'shell.experiments',
      icon: Layers,
      path: '/experiments',
    },
    {
      id: WORKSTATION_SECTIONS.project,
      labelKey: 'shell.newTrainingRun',
      icon: Plus,
      path: '/new',
    },
    {
      id: WORKSTATION_SECTIONS.datasets,
      labelKey: 'shell.datasets',
      icon: Database,
      path: '/datasets',
    },
    {
      id: WORKSTATION_SECTIONS.results,
      labelKey: 'shell.results',
      icon: FileChartColumn,
      path: '/results',
    },
  ];

export const SHELL_ACTION_NAVIGATION: readonly ShellNavigationDescriptor<
  Exclude<WorkstationSection, PrimaryWorkstationSection>
>[] = [
  {
    id: WORKSTATION_SECTIONS.connection,
    labelKey: 'shell.connection',
    icon: Cable,
    path: '/login',
    command: 'connection',
  },
  {
    id: WORKSTATION_SECTIONS.settings,
    labelKey: 'shell.settings',
    icon: Settings2,
    path: '/settings',
    command: 'settings',
  },
];

export function sectionPath(section: PrimaryWorkstationSection, runId?: string): string {
  const navigation = SHELL_PRIMARY_NAVIGATION.find((item) => item.id === section);
  const path = navigation?.path ?? '/experiments';

  if (!runId || (section !== 'experiments' && section !== 'results')) return path;

  return `${path}/${encodeURIComponent(runId)}`;
}

export function sectionForPath(path: string): WorkstationSection {
  if (path === '/login' || path === '/login/') return 'connection';

  if (path === '/settings' || path.startsWith('/settings/')) return 'settings';

  return (
    SHELL_PRIMARY_NAVIGATION.find((item) => path === item.path || path.startsWith(`${item.path}/`))
      ?.id ?? WORKSTATION_SECTIONS.experiments
  );
}

/** The run named by an Experiments or Results URL, if it is a canonical run id. */
export function runIdForPath(path: string): string | null {
  const [, section, runId, ...rest] = path.split('/');

  if (rest.length || (section !== 'experiments' && section !== 'results')) return null;

  return isUuid(runId) ? runId : null;
}

/** Experiments and Results share the current run, as the single-canvas shell did. */
export function navigationPath(path: string, currentRun: string | null): string {
  if (!currentRun || (path !== '/experiments' && path !== '/results')) return path;

  return `${path}/${currentRun}`;
}
