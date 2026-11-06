import type { WorkstationSection } from '~~/types/shell';

export const WORKSTATION_SECTIONS = {
  experiments: 'experiments',
  project: 'project',
  datasets: 'datasets',
  results: 'results',
  connection: 'connection',
  settings: 'settings',
} as const;

export const WORKSTATION_SECTION_IDS: readonly WorkstationSection[] =
  Object.values(WORKSTATION_SECTIONS);

export const PRIMARY_WORKSTATION_SECTION_IDS = [
  WORKSTATION_SECTIONS.experiments,
  WORKSTATION_SECTIONS.project,
  WORKSTATION_SECTIONS.datasets,
  WORKSTATION_SECTIONS.results,
] as const;

export const WORKSTATION_SHELL_TEST_IDS = {
  navigation: 'workstation-nav',
  content: 'workstation-content',
  connectionStatus: 'connection-status',
  commandPalette: 'shell-command-palette',
  panel: 'shell-companion',
} as const;

export function workstationNavTestId(section: WorkstationSection): string {
  return `nav-${section}`;
}
