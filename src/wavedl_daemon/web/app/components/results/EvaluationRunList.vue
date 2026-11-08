<script setup lang="ts">
import { cn } from '@/lib/utils';
import { pathName } from '../../lib/run-overview';
import type { RunView } from '~~/types/daemon-api';

defineProps<{ runs: readonly RunView[]; now: Date; canEvaluate: boolean; staleRunIds: ReadonlySet<string> }>();
const emit = defineEmits<{ select: [runId: string]; evaluate: [] }>();
const { t } = useI18n({ useScope: 'global' });
const labels = useRunLabels();
const styles = {
  row: cn('flex min-w-0 flex-wrap items-center gap-3 border-b border-border/50 p-4 last:border-0 hover:bg-muted/50 focus-within:bg-muted/50'),
  select: cn('min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring'),
};
</script>

<template>
  <section :aria-label="t('results.evaluations')" class="overflow-hidden rounded-xl border bg-surface">
    <ul v-if="runs.length">
      <li v-for="run in runs" :key="run.run_id" :class="styles.row" @click="emit('select', run.run_id)">
        <RunStateChip :run="run" :stale="staleRunIds.has(run.run_id)" />
        <button type="button" :class="styles.select">
          <span class="block truncate text-sm font-medium">{{ pathName(run.summary?.data_path) || t('results.unknownDataset') }}</span>
          <span class="block text-xs text-muted-foreground">{{ labels.operation(run) }}<template v-if="labels.created(run, now)"> · {{ labels.created(run, now) }}</template></span>
          <span class="sr-only">{{ run.run_id }}</span>
        </button>
      </li>
    </ul>
    <Empty v-else class="py-10">
      <EmptyDescription>{{ t('results.noEvaluations') }}</EmptyDescription>
      <EmptyContent><Button type="button" :disabled="!canEvaluate" @click="emit('evaluate')">{{ t('results.evaluate') }}</Button></EmptyContent>
    </Empty>
  </section>
</template>
