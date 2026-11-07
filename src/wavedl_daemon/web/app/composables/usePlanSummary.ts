import { buildPlanSummary } from '../lib/plan-summary';
import type { PlanView } from '~~/types/daemon-api';

export function usePlanSummary(
  source: MaybeRefOrGetter<PlanView | null>,
  fullSettings: MaybeRefOrGetter<boolean> = false,
) {
  const { t } = useI18n({ useScope: 'global' });
  const summary = computed(() => buildPlanSummary(toValue(source), t, toValue(fullSettings)));
  const manifest = computed(() => summary.value.manifest);
  const differences = computed(() => summary.value.differences);
  const context = computed(() => summary.value.context);
  const sections = computed(() => summary.value.sections);
  const warnings = computed(() => summary.value.warnings);
  const rawPlan = computed(() => JSON.stringify(toValue(source)?.preview ?? null, null, 2));

  return { manifest, differences, context, sections, warnings, rawPlan };
}
