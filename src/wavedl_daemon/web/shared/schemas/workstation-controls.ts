import { z } from 'zod';
import { trainingRequestSchema } from './training-request';
import { inferenceConfigSchema } from './result-request';
import { WORKSTATION_SECTIONS } from '../constants/workstation-sections';

export const runtimeDeviceSchema = trainingRequestSchema.shape.runtime.shape.device;
export const resultExportSchema = inferenceConfigSchema.shape.export;

export function segmentedSelectionSchema(choices: readonly string[]) {
  return z.enum(choices);
}

export const locateRequestSchema = z.object({ root: z.string(), path: z.string() });

export const storedDockSlotsSchema = z
  .array(z.enum(WORKSTATION_SECTIONS).nullable().catch(null))
  .length(5);

export type StoredDockSlots = z.output<typeof storedDockSlotsSchema>;

export const storedShellSidebarSchema = z.object({
  collapsed: z.boolean().catch(false),
  activeRunsOpen: z.boolean().catch(true),
});

export type StoredShellSidebar = z.output<typeof storedShellSidebarSchema>;

export const DEFAULT_SHELL_SIDEBAR: StoredShellSidebar = {
  collapsed: false,
  activeRunsOpen: true,
};
