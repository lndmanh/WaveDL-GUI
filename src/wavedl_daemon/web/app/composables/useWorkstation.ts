import type { WorkstationContext } from '~~/types/workstation';

const workstationKey: InjectionKey<WorkstationContext> = Symbol('workstation');

export function provideWorkstation(context: WorkstationContext): void {
  provide(workstationKey, context);
}

export function useWorkstation(): WorkstationContext {
  const context = inject(workstationKey);

  if (!context) throw new Error('useWorkstation() must be called inside the workstation layout.');

  return context;
}
