<script setup lang="ts">
import { cn } from '@/lib/utils';
import { listRowStyles } from '@/lib/list-row-styles';
import { CircleX } from '@lucide/vue';
import { relativeTime, runCreatedAt } from '../../lib/run-overview';
import { runActivityMessageKeysFor, runStateMessageKeys } from '../../i18n/dynamic-keys';
import type { RunView } from '~~/types/daemon-api';
import type { RunColumn } from '~~/types/run-overview';

const props = defineProps<{
  run: RunView;
  columns: readonly RunColumn[];
  folded: boolean;
  selected: boolean;
  current: boolean;
  stale: boolean;
  now: Date;
}>();

const emit = defineEmits<{
  select: [runId: string];
  move: [event: KeyboardEvent, step: -1 | 1];
}>();

const { t, locale } = useI18n({ useScope: 'global' });
const labels = useRunLabels();
const created = computed(() => runCreatedAt(props.run));

const exactTime = computed(() =>
  created.value
    ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(
        created.value,
      )
    : undefined,
);

const shortTime = computed(() =>
  created.value ? relativeTime(created.value, props.now, locale.value, 'short') : '–',
);

const longTime = computed(() =>
  created.value ? relativeTime(created.value, props.now, locale.value) : '–',
);

const activity = computed(() => runActivityMessageKeysFor(props.run));
const activityLabel = computed(() => (activity.value ? t(activity.value.label) : null));

const stateLabel = computed(
  () =>
    `${t(runStateMessageKeys[props.run.state])}${activityLabel.value ? ` · ${activityLabel.value}` : ''}${props.stale ? t('runs.stale') : ''}${props.run.state !== 'planned' && props.run.uncertainty ? t('runs.uncertain') : ''}`,
);

const progressLabel = computed(() =>
  props.run.progress
    ? t('runs.progressComplete', {
        percent: new Intl.NumberFormat(locale.value, {
          style: 'percent',
          maximumFractionDigits: 0,
        }).format(props.run.progress.fraction),
      })
    : t('runs.progressUnknown'),
);

const metadata = computed(() => props.columns.filter((column) => column.id !== 'name'));

function selectCell(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('button, [role="note"], a, input'))
    return;
  emit('select', props.run.run_id);
}
</script>

<template>
  <tr :class="listRowStyles.row" :data-run-id="run.run_id" :data-selected="selected" @click="selectCell">
    <td class="p-0">
      <div :class="cn(listRowStyles.cell, 'flex items-center justify-center px-0')">
        <span :class="listRowStyles.glyph" :data-state="run.state" aria-hidden="true" />
        <span class="sr-only">{{ stateLabel }}</span>
      </div>
    </td>
    <td class="p-0">
      <div :class="cn(listRowStyles.cell, 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2')">
        <button
          type="button"
          :class="listRowStyles.title"
          :data-run-id="run.run_id"
          :aria-current="current ? 'true' : undefined"
          :title="labels.title(run)"
          @click="emit('select', run.run_id)"
          @keydown.down="emit('move', $event, 1)"
          @keydown.up="emit('move', $event, -1)"
        >
          {{ labels.title(run) }}<span class="sr-only">, {{ stateLabel }}</span>
        </button>
        <span
          data-trailing
          :aria-hidden="!folded"
          :class="
            cn(
              listRowStyles.trailing,
              stale && 'opacity-60',
            )
          "
        >
          <span
            v-if="folded && activityLabel"
            class="max-w-32 truncate"
            :title="activityLabel"
            aria-live="polite"
            >{{ activityLabel }}</span
          >
          <time
            class="shrink-0 whitespace-nowrap"
            :datetime="created?.toISOString()"
            :title="exactTime"
            >{{ shortTime }}</time
          >
          <svg
            v-if="run.state === 'running'"
            viewBox="0 0 16 16"
            role="img"
            :aria-label="`${progressLabel}${stale ? t('runs.stale') : ''}`"
            :class="
              cn(
                'size-4 shrink-0 text-primary',
                !run.progress && 'animate-spin motion-reduce:animate-none',
              )
            "
          >
            <title>{{ progressLabel }}{{ stale ? t('runs.stale') : '' }}</title>
            <circle
              cx="8"
              cy="8"
              r="5.5"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="opacity-20"
            />
            <circle
              cx="8"
              cy="8"
              r="5.5"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              pathLength="1"
              :stroke-dasharray="`${run.progress?.fraction ?? 0.25} 1`"
              transform="rotate(-90 8 8)"
            />
          </svg>
          <CircleX
            v-else-if="run.state === 'failed'"
            class="size-4 shrink-0 text-destructive"
            role="img"
            :aria-label="t('runs.failed')"
          />
          <span v-else class="size-4 shrink-0" aria-hidden="true" />
        </span>
      </div>
    </td>
    <td
      v-for="column in metadata"
      :key="column.id"
      data-metadata
      class="p-0"
      :aria-hidden="folded"
      :inert="folded"
    >
      <div v-if="column.id === 'state'" :class="cn(listRowStyles.cell, listRowStyles.state)">
        <RunStateChip :run="run" :stale="stale" compact />
      </div>
      <div v-else :class="cn(listRowStyles.cell, 'flex items-center text-muted-foreground')">
        <time
          v-if="column.id === 'created'"
          class="truncate"
          :datetime="created?.toISOString()"
          :title="exactTime"
          >{{ longTime }}</time
        >
        <span v-else class="truncate" :title="String(column.value(run) ?? '–')">{{
          column.value(run) ?? '–'
        }}</span>
      </div>
    </td>
  </tr>
</template>
