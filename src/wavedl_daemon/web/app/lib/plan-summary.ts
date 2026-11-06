import type { Json, PlanView } from './daemon-api';
import { planManifestSchema, planPreviewContextSchema } from '../../shared/schemas/plan-summary';
import {
  trainingConfigSchema,
  trainingDefaults,
  trainingFieldMetadata,
} from '../../shared/schemas/training-request';
import { inferenceDefaults } from '../../shared/schemas/result-request';
import {
  planRuntimeMessageKeys,
  runOperationMessageKeys,
  trainingChoiceLabel,
  trainingFieldMessageKeys,
  trainingSectionMessageKeys,
} from '../i18n/dynamic-keys';
import {
  compactNumber,
  essentialTrainingFields,
  trainingFieldVisible,
  trainingSections,
  type TrainingFieldName,
} from './training-layout';

export interface PlanRow {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly changed: boolean;
}

export interface PlanSection {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly PlanRow[];
}

type PlanTrainingFieldName = TrainingFieldName | 'model' | 'data_path';

interface PlanFact {
  readonly label: string;
  readonly value: string;
  readonly fullValue?: string;
}

export type PlanCommand =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string };

export function buildPlanSummary(
  plan: PlanView | null,
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  function display(value: Json | undefined, name = ''): string {
    if (value === undefined || value === null) return t('project.none');
    if (typeof value === 'boolean') return t(value ? 'builder.on' : 'builder.off');
    if (typeof value === 'number') return compactNumber(value);
    if (Array.isArray(value))
      return value.length ? value.map((item) => display(item, name)).join(', ') : t('project.none');
    if (typeof value === 'object')
      return Object.entries(value)
        .map(([key, item]) => `${key} = ${display(item)}`)
        .join(', ');

    return trainingFieldMetadata.some((field) => field.name === name && field.choices.length)
      ? trainingChoiceLabel(name, value, t)
      : value;
  }

  function text(value: string | undefined | null): string {
    return value || t('project.notAvailable');
  }

  function runtimeLabel(value: string | undefined): string {
    const key = Object.entries(planRuntimeMessageKeys).find(([name]) => name === value)?.[1];

    return key ? t(key) : text(value);
  }

  function operationLabel(value: string | undefined): string {
    if (value === 'train' || value === 'test' || value === 'plot')
      return t(runOperationMessageKeys[value]);

    return text(value);
  }

  const parsed = planManifestSchema.safeParse(plan?.preview.spec);
  const document = parsed.success ? parsed.data : null;
  const manifest = document?.manifest ?? null;
  const review = document?.review;
  const config = review?.resolved_config ?? {};
  const training = review?.operation === 'train';
  const defaults = Object.entries(training ? trainingDefaults : inferenceDefaults);
  const preview = planPreviewContextSchema.parse(plan?.preview ?? {});
  const runtime = review?.runtime;
  const topology = preview.topology;
  const changed = (name: string, value: Json) => {
    const fallback = defaults.find(([key]) => key === name);

    return !!fallback && JSON.stringify(value) !== JSON.stringify(fallback[1]);
  };
  const differences = Object.entries(config).flatMap(([name, value]) => {
    const fallback = defaults.find(([key]) => key === name);

    if (name === 'data_path' || !fallback || !changed(name, value)) return [];

    return [
      {
        name,
        label: trainingFieldMessageKeys[name] ? t(trainingFieldMessageKeys[name].label) : name,
        value: display(value, name),
        defaultValue: display(fallback[1], name),
      },
    ];
  });

  const parallelism = [
    t('project.machineCount', { count: topology.num_machines ?? t('project.notAvailable') }),
    t('project.processesPerMachineCount', {
      count: topology.processes_per_machine ?? t('project.notAvailable'),
    }),
  ].join(', ');
  const dataset = typeof config.data_path === 'string' ? config.data_path : undefined;
  const context: readonly PlanFact[] = training ? [
    {
      label: t('project.dataset'),
      value: dataset?.split(/[\\/]/).filter(Boolean).pop() || t('project.notAvailable'),
      fullValue: dataset,
    },
    { label: t('training.model.label'), value: display(config.model) },
    { label: t('project.whereItRuns'), value: runtimeLabel(preview.target) },
    { label: t('project.contextOperation'), value: operationLabel(review?.operation) },
    { label: t('project.hardware'), value: runtimeLabel(runtime?.device) },
    { label: t('builder.distributed'), value: parallelism },
  ] : [
    { label: t('project.contextBackend'), value: runtimeLabel(preview.target) },
    { label: t('project.contextOperation'), value: operationLabel(review?.operation) },
    { label: t('project.contextDevice'), value: runtimeLabel(runtime?.device) },
    { label: t('project.contextTopology'), value: parallelism },
  ];

  const validatedConfig = trainingConfigSchema.safeParse(config);
  function trainingRow(name: PlanTrainingFieldName): PlanRow[] {
    const value = config[name];

    if (
      value === undefined || value === null || value === '' ||
      (Array.isArray(value) && !value.length)
    ) return [];
    if (
      name !== 'model' && name !== 'data_path' && validatedConfig.success &&
      !trainingFieldVisible(name, validatedConfig.data)
    ) return [];

    return [
      {
        name,
        label: trainingFieldMessageKeys[name] ? t(trainingFieldMessageKeys[name].label) : name,
        value: display(value, name),
        changed: changed(name, value),
      },
    ];
  }

  const sectionTable: readonly {
    readonly id: string;
    readonly title: string;
    readonly fields: readonly PlanTrainingFieldName[];
  }[] = [
    {
      id: 'main',
      title: t('project.mainSettings'),
      fields: ['model', 'data_path', 'pretrained', ...essentialTrainingFields],
    },
    ...trainingSections.map((section) => ({
      ...section,
      title: t(trainingSectionMessageKeys[section.id]),
    })),
  ];
  const environmentNames = [...new Set([
    ...Object.keys(runtime?.environment ?? {}),
    ...(preview.environment ?? []).map(([name]) => name),
  ])].join(', ');
  const runtimeRows: readonly {
    readonly name: string;
    readonly label: string;
    readonly value: string | undefined | null;
  }[] = [
    { name: 'backend', label: t('project.whereItRuns'), value: runtimeLabel(preview.target) },
    {
      name: 'mode',
      label: t('project.pythonEnvironment'),
      value: runtime?.mode ? runtimeLabel(runtime.mode) : undefined,
    },
    { name: 'python', label: t('project.pythonInterpreter'), value: runtime?.python },
    { name: 'container', label: t('project.containerEnvironment'), value: runtime?.container },
    { name: 'device', label: t('project.hardware'), value: runtimeLabel(runtime?.device) },
    { name: 'parallelism', label: t('builder.distributed'), value: parallelism },
    { name: 'run_directory', label: t('project.runFolder'), value: review?.run_directory },
    {
      name: 'working_directory',
      label: t('project.trainingFolder'),
      value: review?.working_directory !== review?.run_directory ? review?.working_directory : undefined,
    },
    { name: 'environment', label: t('project.environmentVariableNames'), value: environmentNames },
    ...(review?.storage_map?.map((mapping, index) => ({
      name: `storage_map.${index}`,
      label: t('project.folderMapping'),
      value: `${mapping.host_root} → ${mapping.execution_root}`,
    })) ?? []),
    ...(preview.resources ?? []).map(([name, value]) => ({
      name: `resource.${name}`,
      label: t('project.clusterResource', { name }),
      value: value === null ? undefined : display(value),
    })),
    { name: 'run_id', label: t('runs.configRunId'), value: plan?.run_id },
    { name: 'plan_id', label: t('project.planId'), value: plan?.plan_id },
  ];
  const sections: readonly PlanSection[] = training ? [
    ...sectionTable.map(({ id, title, fields }) => ({ id, title, rows: fields.flatMap(trainingRow) })),
    {
      id: 'runtime',
      title: t('project.whereItRuns'),
      rows: runtimeRows.flatMap(({ name, label, value }) =>
        value ? [{ name, label, value, changed: false }] : [],
      ),
    },
  ].filter((section) => section.rows.length > 0) : [];

  return { manifest, differences, context, sections, warnings: preview.warnings ?? [] };
}
