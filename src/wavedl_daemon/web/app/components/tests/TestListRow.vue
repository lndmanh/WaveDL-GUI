<script setup lang="ts">
import { cn } from '@/lib/utils';
import { listRowStyles } from '../../lib/list-row-styles';
import { checkpointLabel, isCompareEligible, parentTitle } from '../../lib/test-runs';
import { pathName, relativeTime, runCreatedAt, runKindOf } from '../../lib/run-overview';
import { runKindMessageKeys, runStateMessageKeys } from '../../i18n/dynamic-keys';
import type { TrainingBaseline } from '../../lib/evaluation-scorecard';
import type { RunView } from '~~/types/daemon-api';

const props = defineProps<{
  run: RunView;
  now: Date;
  selected: boolean;
  checked: boolean;
  showTrainingRun?: boolean;
  baseline?: TrainingBaseline | null;
  stale: boolean;
}>();
const emit = defineEmits<{
  select: [id: string];
  check: [id: string, checked: boolean];
  move: [event: KeyboardEvent, step: -1 | 1];
}>();
const { t, locale } = useI18n({ useScope: 'global' });
const dataset = computed(() => pathName(props.run.summary?.data_path) || t('results.unknownDataset'));
const checkpoint = computed(() => checkpointLabel(props.run.summary?.checkpoint));
const kind = computed(() => runKindOf(props.run));
const eligible = computed(() => isCompareEligible(props.run));
const created = computed(() => runCreatedAt(props.run));
const age = computed(() => created.value ? relativeTime(created.value, props.now, locale.value, 'short') : '–');
const state = computed(() => `${t(runStateMessageKeys[props.run.state])}${props.stale ? t('runs.stale') : ''}${props.run.uncertainty ? t('runs.uncertain') : ''}`);
const r2 = computed(() => props.run.evaluation?.r2_score ?? null);
const delta = computed(() => {
  const baseline = props.baseline?.r2_score;

  if (props.run.summary?.checkpoint !== 'best_checkpoint' || r2.value === null || baseline == null)
    return null;

  return r2.value - baseline;
});
const deltaText = computed(() => delta.value === null ? '' : `${delta.value < 0 ? '−' : '+'}${Math.abs(delta.value).toFixed(3)}`);
const deltaLabel = computed(() => {
  if (delta.value === null) return '';
  const direction = delta.value > 0 ? 'results.r2Better' : delta.value < 0 ? 'results.r2Worse' : 'results.r2Unchanged';

  return `${t('results.r2Change', { change: deltaText.value })} · ${t(direction)}`;
});
const progress = computed(() => props.run.progress ? new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 0 }).format(props.run.progress.fraction) : null);

function selectCell(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('button, input, [role="checkbox"], [data-checkbox]')) return;
  emit('select', props.run.run_id);
}
</script>

<template>
  <tr :class="listRowStyles.row" :data-selected="selected" @click="selectCell">
    <td class="w-9 p-0">
      <div :class="cn(listRowStyles.cell, 'flex items-center justify-center px-1')" data-checkbox>
        <Tooltip>
          <TooltipTrigger as-child>
            <span class="inline-flex rounded-sm focus-visible:ring-2 focus-visible:ring-ring" :tabindex="eligible ? undefined : 0">
              <Checkbox
                :model-value="checked"
                :disabled="!eligible"
                :aria-label="t('results.selectTest', { dataset })"
                @update:model-value="emit('check', run.run_id, $event === true)"
              />
            </span>
          </TooltipTrigger>
          <TooltipContent v-if="!eligible">{{ t('results.compareIneligible') }}</TooltipContent>
        </Tooltip>
      </div>
    </td>
    <td class="w-6 p-0">
      <div :class="cn(listRowStyles.cell, 'flex items-center justify-center px-1')">
        <span :class="listRowStyles.glyph" :data-state="run.state" aria-hidden="true" />
        <span class="sr-only">{{ state }}</span>
      </div>
    </td>
    <td class="p-0">
      <div :class="cn(listRowStyles.cell, 'flex items-center gap-2')">
        <button
          type="button"
          :class="cn(listRowStyles.title, 'test-row flex flex-1 flex-col justify-center')"
          :data-test-id="run.run_id"
          :aria-current="selected ? 'true' : undefined"
          :title="dataset"
          @click="emit('select', run.run_id)"
          @keydown.down="emit('move', $event, 1)"
          @keydown.up="emit('move', $event, -1)"
        >
          <span class="w-full truncate">{{ dataset }}</span>
          <span v-if="checkpoint" class="w-full truncate text-[0.7rem] font-normal text-muted-foreground">{{ t(checkpoint.key, checkpoint.params ?? {}) }}</span>
          <span class="sr-only">{{ state }}</span>
        </button>
        <Badge v-if="kind !== 'evaluation'" variant="secondary" class="max-w-24 truncate text-[0.65rem]" :title="t(runKindMessageKeys[kind])">{{ t(runKindMessageKeys[kind]) }}</Badge>
      </div>
    </td>
    <td v-if="showTrainingRun" class="w-1/4 p-0">
      <div :class="cn(listRowStyles.cell, 'flex items-center text-muted-foreground')">
        <span class="truncate" :title="parentTitle(run) ?? undefined">{{ parentTitle(run) ?? '–' }}</span>
      </div>
    </td>
    <td class="w-32 p-0">
      <div :class="cn(listRowStyles.cell, 'flex flex-col items-end justify-center text-[0.7rem] text-muted-foreground tabular-nums', stale && 'opacity-60')">
        <span v-if="r2 !== null" class="whitespace-nowrap">R² {{ r2.toFixed(3) }}
          <span v-if="delta !== null" :class="delta > 0 ? 'text-success' : delta < 0 ? 'text-destructive' : ''" :title="deltaLabel"><span aria-hidden="true">{{ deltaText }}</span><span class="sr-only">{{ deltaLabel }}</span></span>
        </span>
        <span v-else-if="run.state === 'running'" role="status">{{ progress ?? t('runs.running') }}</span>
        <time :datetime="created?.toISOString()" :title="created?.toLocaleString(locale)">{{ age }}</time>
      </div>
    </td>
  </tr>
</template>
