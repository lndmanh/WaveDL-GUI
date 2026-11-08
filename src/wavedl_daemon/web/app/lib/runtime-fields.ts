import type { TrainingRequest } from '../../shared/schemas/training-request';
import { runtimeFieldMessageKeys, runtimeValueMessageKeys } from '../i18n/dynamic-keys';
import type { RuntimeValue } from '~~/types/i18n';

interface RuntimeChoiceField<Name extends string, Value extends string> {
  readonly name: Name;
  readonly label: string;
  readonly values: readonly Value[];
}

export const runtimePythonField: {
  readonly name: 'runtime.python';
  readonly label: string;
  readonly description: string;
} = {
  name: 'runtime.python',
  label: runtimeFieldMessageKeys.pythonInterpreter,
  description: runtimeFieldMessageKeys.interpreterDescription,
};

export const runtimeBackendField: RuntimeChoiceField<'backend', TrainingRequest['backend']> = {
  name: 'backend',
  label: runtimeFieldMessageKeys.backend,
  values: ['local', 'slurm'],
};

export const runtimeModeField: RuntimeChoiceField<
  'runtime.mode',
  TrainingRequest['runtime']['mode']
> = {
  name: 'runtime.mode',
  label: runtimeFieldMessageKeys.mode,
  values: ['existing', 'selected', 'bundled', 'container'],
};

export const runtimeDeviceField: RuntimeChoiceField<
  'runtime.device',
  TrainingRequest['runtime']['device']
> & {
  readonly cardValues: readonly TrainingRequest['runtime']['device'][];
} = {
  name: 'runtime.device',
  label: runtimeFieldMessageKeys.device,
  values: ['cpu', 'mps', 'cuda', 'auto'],
  cardValues: ['cpu', 'cuda', 'mps', 'auto'],
};

export const runtimeTopologyFields: readonly {
  name: `topology.${keyof TrainingRequest['topology']}`;
  label: (typeof runtimeFieldMessageKeys)['machines' | 'processesPerMachine' | 'machineRank'];
  min: 0 | 1;
}[] = [
  { name: 'topology.num_machines', label: runtimeFieldMessageKeys.machines, min: 1 },
  {
    name: 'topology.processes_per_machine',
    label: runtimeFieldMessageKeys.processesPerMachine,
    min: 1,
  },
  { name: 'topology.machine_rank', label: runtimeFieldMessageKeys.machineRank, min: 0 },
];

export function runtimeFieldValueLabel(
  value: RuntimeValue,
  translate: (key: string) => string,
): string {
  const key = runtimeValueMessageKeys[value];

  return key ? translate(key) : value;
}
