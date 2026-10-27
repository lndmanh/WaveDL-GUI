export const WORKSTATION_SECTIONS = {
  experiments: 'experiments',
  project: 'project',
  datasets: 'datasets',
  results: 'results',
  adopt: 'adopt',
  connection: 'connection',
  settings: 'settings',
} as const;

export type WorkstationSection = (typeof WORKSTATION_SECTIONS)[keyof typeof WORKSTATION_SECTIONS];
export const WORKSTATION_SECTION_IDS: readonly WorkstationSection[] =
  Object.values(WORKSTATION_SECTIONS);

export const WORKSTATION_SHELL_TEST_IDS = {
  navigation: 'workstation-nav',
  content: 'workstation-content',
  connectionStatus: 'connection-status',
} as const;

export function workstationNavTestId(section: WorkstationSection): string {
  return `nav-${section}`;
}
