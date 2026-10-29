<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed } from 'vue';
import type { RuntimeMetricSummary } from '../../lib/metric-history';
const { t, locale } = useI18n({ useScope: 'global' });
const props = defineProps<{ parameters: RuntimeMetricSummary['parameters'] }>();
// Bars compare parameters with each other only; the largest error fills the track.
const largest = computed(() =>
  Math.max(
    0,
    ...props.parameters.map((parameter) =>
      parameter.value !== null && Number.isFinite(parameter.value) ? Math.abs(parameter.value) : 0,
    ),
  ),
);
function share(value: number | null): string {
  if (value === null || !largest.value) return '0%';
  return `${Math.max(2, (Math.abs(value) / largest.value) * 100)}%`;
}
</script>
<template>
  <section :aria-label="t('runs.perParam')" class="insight-card">
    <h4 class="insight-title">{{ t('runs.perParam') }}</h4>
    <dl class="flex flex-col parameter-list">
      <div v-for="parameter in parameters" :key="parameter.name" class="parameter-row">
        <dt>{{ parameter.name }}</dt>
        <dd :title="parameter.value === null ? undefined : String(parameter.value)">
          {{
            parameter.value === null
              ? t('runs.unavailable')
              : new Intl.NumberFormat(locale, { maximumSignificantDigits: 4 }).format(
                  parameter.value,
                )
          }}
        </dd>
        <span class="parameter-track" aria-hidden="true"
          ><span class="parameter-bar" :style="{ width: share(parameter.value) }"
        /></span>
      </div>
    </dl>
    <p v-if="!parameters.length" class="text-muted-foreground text-sm">
      {{ t('runs.noPerParam') }}
    </p>
  </section>
</template>
<style scoped>
.insight-card {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
  padding: 0.95rem 1rem;
  border-radius: 1rem;
  background: color-mix(in srgb, var(--foreground) 3.5%, transparent);
}
.insight-title {
  font-size: 0.85rem;
  font-weight: 650;
}
.parameter-list {
  gap: 0.55rem;
  margin: 0;
}
.parameter-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.25rem 0.75rem;
  font-size: 0.82rem;
}
.parameter-row dt {
  overflow: hidden;
  color: var(--muted-foreground);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.parameter-row dd {
  margin: 0;
  font-weight: 550;
  font-variant-numeric: tabular-nums;
}
.parameter-track {
  grid-column: 1 / -1;
  height: 0.3rem;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--foreground) 7%, transparent);
}
.parameter-bar {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--primary);
  transition: width 420ms cubic-bezier(0.22, 1, 0.36, 1);
}
</style>
