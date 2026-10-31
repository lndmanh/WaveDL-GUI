import { SHELL_ACTION_NAVIGATION, SHELL_PRIMARY_NAVIGATION } from '../shell/sections';
import type { WorkstationSection, ShellNavigationDescriptor } from '../shell/sections';

export type ShellDockDestinationId = WorkstationSection;

export type ShellDockDestination = ShellNavigationDescriptor;

export type ShellDockSlots = [
  WorkstationSection,
  WorkstationSection,
  WorkstationSection,
  WorkstationSection,
  WorkstationSection,
];

export const SHELL_DOCK_SLOT_COUNT = 5;
export const DEFAULT_SHELL_DOCK_SLOTS: ShellDockSlots = [
  'experiments',
  'project',
  'datasets',
  'results',
  'settings',
];

export const SHELL_DOCK_DESTINATIONS: readonly ShellDockDestination[] = [
  ...SHELL_PRIMARY_NAVIGATION,
  ...SHELL_ACTION_NAVIGATION,
];

export function getShellDockDestination(
  id: ShellDockDestinationId,
): ShellDockDestination | undefined {
  return SHELL_DOCK_DESTINATIONS.find((item) => item.id === id);
}

export function resolveShellDockSlots(stored: unknown): ShellDockSlots {
  if (!Array.isArray(stored) || stored.length !== SHELL_DOCK_SLOT_COUNT)
    return [...DEFAULT_SHELL_DOCK_SLOTS];
  const used = new Set<WorkstationSection>();
  const resolved: WorkstationSection[] = [];

  for (let index = 0; index < SHELL_DOCK_SLOT_COUNT; index += 1) {
    const candidate: unknown = stored[index];

    const item =
      SHELL_DOCK_DESTINATIONS.find(
        (destination) => destination.id === candidate && !used.has(destination.id),
      ) ??
      SHELL_DOCK_DESTINATIONS.find(
        (destination) =>
          destination.id === DEFAULT_SHELL_DOCK_SLOTS[index] && !used.has(destination.id),
      ) ??
      SHELL_DOCK_DESTINATIONS.find((destination) => !used.has(destination.id));

    if (!item) return [...DEFAULT_SHELL_DOCK_SLOTS];
    used.add(item.id);
    resolved.push(item.id);
  }

  const [first, second, third, fourth, fifth] = resolved;

  if (!first || !second || !third || !fourth || !fifth) return [...DEFAULT_SHELL_DOCK_SLOTS];

  return [first, second, third, fourth, fifth];
}
