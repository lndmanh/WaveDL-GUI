import { WORKSTATION_SECTIONS } from '../../shared/constants/workstation-sections';

export { WORKSTATION_SECTIONS } from '../../shared/constants/workstation-sections';

export const PRIMARY_WORKSTATION_SECTION_IDS = [
  WORKSTATION_SECTIONS.experiments,
  WORKSTATION_SECTIONS.project,
  WORKSTATION_SECTIONS.datasets,
  WORKSTATION_SECTIONS.results,
] as const;
