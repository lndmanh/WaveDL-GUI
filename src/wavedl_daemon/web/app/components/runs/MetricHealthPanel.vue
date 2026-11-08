<script setup lang="ts">
import { cn } from '@/lib/utils';
import {
  metricHealthLabelMessageKeys,
  metricHealthStatusMessageKeys,
} from '../../i18n/dynamic-keys';
import type { MetricHealth } from '~~/types/metric-history';

// Utility bundles keep state and descendant styling beside their component.
const styles = {
  healthRow: cn(
    '[--tone:var(--success)] flex flex-wrap items-center justify-between [gap:0.35rem_0.75rem]',
    'p-[0.45rem_0] text-[0.82rem]',
    '[&+&]:[border-top:1px_solid_color-mix(in_srgb,_var(--border)_55%,_transparent)]!',
    "[&[data-severity='warning']]:[--tone:var(--warning)]",
    "[&[data-severity='error']]:[--tone:var(--color-destructive)] [&_dt]:flex [&_dt]:items-center",
    '[&_dt]:gap-2 [&_dt_i]:w-2 [&_dt_i]:h-2 [&_dt_i]:rounded-full [&_dt_i]:bg-(--tone)',
    '[&_dt_i]:shadow-[0_0_0_3px_color-mix(in_srgb,_var(--tone)_18%,_transparent)] [&_dd]:flex',
    '[&_dd]:items-center [&_dd]:gap-2 [&_dd]:m-0',
  ),
};

const { t } = useI18n({ useScope: 'global' });

defineProps<{ health: readonly MetricHealth[]; waiting: boolean }>();

function translated<const Mapping extends Readonly<Record<string, string>>>(
  mapping: Mapping,
  value: string,
): string {
  const key = Object.entries(mapping).find(([name]) => name === value)?.[1];

  return key === undefined ? value : t(key);
}

function displayHealthValue(row: MetricHealth): string {
  if (row.label === 'Overfitting' && row.value.startsWith('Gap: '))
    return t('runs.gap', { value: row.value.slice(5) });

  if (row.label === 'Convergence' && row.value.startsWith('Epoch '))
    return t('runs.healthEpoch', { value: row.value.slice(6) });

  return row.value;
}
</script>
<template>
  <section :aria-label="t('runs.health')" class="flex min-w-0 flex-col gap-[0.6rem]">
    <dl class="flex flex-col m-0">
      <div
        v-for="row in health"
        :key="row.label"
        :class="cn('health-row', styles.healthRow)"
        :data-severity="row.severity"
      >
        <dt><i aria-hidden="true" />{{ translated(metricHealthLabelMessageKeys, row.label) }}</dt>
        <dd>
          <span class="text-muted-foreground tabular-nums">{{ displayHealthValue(row) }}</span>
          <Badge
            :variant="
              row.severity === 'error'
                ? 'destructive'
                : row.severity === 'warning'
                  ? 'outline'
                  : 'secondary'
            "
            >{{ translated(metricHealthStatusMessageKeys, row.status) }}</Badge
          >
        </dd>
      </div>
    </dl>
    <div
      v-if="!health.length && waiting"
      role="status"
      class="flex items-center gap-2 text-sm text-muted-foreground"
    >
      <LoadingSpinner compact size="sm" />
      <p>{{ t('runs.waitingHealth') }}</p>
    </div>
    <p v-else-if="!health.length" class="text-muted-foreground text-sm">
      {{ t('runs.noHealth') }}
    </p>
  </section>
</template>
