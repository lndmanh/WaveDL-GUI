import { validateJson, type Json, type JsonObject, type PlanView } from '../lib/daemon-api';
import { trainingDefaults } from '../../shared/schemas/training-request';
import { inferenceDefaults } from '../../shared/schemas/result-request';
import { trainingFieldMessageKeys } from '../i18n/dynamic-keys';

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function equal(left: Json, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Reads a persisted plan for review: its manifest, context and non-default values. */
export function usePlanSummary(source: MaybeRefOrGetter<PlanView | null>) {
  const { t } = useI18n({ useScope: 'global' });

  function display(value: Json | undefined): string {
    if (value === undefined || value === null) return t('project.none');

    if (Array.isArray(value))
      return value.length ? value.map((item) => display(item)).join(', ') : t('project.none');

    if (typeof value === 'object') return JSON.stringify(value);

    return String(value);
  }

  function text(value: Json | undefined): string {
    return typeof value === 'string' ? value : t('project.notAvailable');
  }

  const manifest = computed<JsonObject | null>(() => {
    const raw = toValue(source)?.preview.manifest_json;

    if (typeof raw !== 'string') return null;

    try {
      const value: Json = JSON.parse(raw);
      validateJson(value);

      return object(value) ? value : null;
    } catch {
      return null;
    }
  });

  const config = computed(() => {
    const value = manifest.value?.resolved_config;

    return object(value) ? value : {};
  });

  const differences = computed(() => {
    const defaults = Object.entries(
      manifest.value?.operation === 'train' ? trainingDefaults : inferenceDefaults,
    );

    return Object.entries(config.value).flatMap(([name, value]) => {
      const fallback = defaults.find(([key]) => key === name);

      if (!fallback || equal(value, fallback[1])) return [];

      return [
        {
          name,
          label: trainingFieldMessageKeys[name] ? t(trainingFieldMessageKeys[name].label) : name,
          value: display(value),
          defaultValue: display(fallback[1]),
        },
      ];
    });
  });

  const context = computed(() => {
    const plan = toValue(source);
    const runtimeValue = manifest.value?.runtime;
    const topologyValue = plan?.preview.topology;
    const runtime = object(runtimeValue) ? runtimeValue : {};
    const topology = object(topologyValue) ? topologyValue : {};

    return [
      { label: t('project.contextBackend'), value: text(plan?.preview.target) },
      { label: t('project.contextOperation'), value: text(manifest.value?.operation) },
      { label: t('project.contextDevice'), value: text(runtime.device) },
      {
        label: t('project.contextTopology'),
        value: `${display(topology.num_machines)} × ${display(topology.processes_per_machine)}`,
      },
    ];
  });

  const rawPlan = computed(() => JSON.stringify(toValue(source)?.preview ?? null, null, 2));

  return { manifest, differences, context, rawPlan };
}
