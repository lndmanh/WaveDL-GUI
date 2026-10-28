<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed } from 'vue';
import type { RunView } from '../../lib/daemon-api';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import RunStateChip from './RunStateChip.vue';
import InfoChip from '../common/InfoChip.vue';
import { runOperationMessageKeys } from '../../i18n/dynamic-keys';
const { t, locale } = useI18n({ useScope: 'global' });
const props = defineProps<{
  runs: readonly RunView[];
  loading: boolean;
  page: number;
  staleRunIds?: ReadonlySet<string>;
  lastRefreshed?: string | null;
}>();
const updatedLabel = computed(() => {
  const date = new Date(props.lastRefreshed ?? '');
  return Number.isNaN(date.getTime())
    ? t('runs.unavailable')
    : t('runs.updatedTime', {
        time: new Intl.DateTimeFormat(locale.value === 'vi' ? 'vi-VN' : 'en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(date),
      });
});
defineEmits<{ select: [runId: string]; refresh: []; page: [offset: number] }>();
</script>
<template>
  <section class="run-list" :aria-label="t('runs.runs')">
    <div class="toolbar">
      <h2 class="heading">{{ t('runs.runs') }}</h2>
      <Button variant="outline" :disabled="loading" @click="$emit('refresh')">{{
        t('runs.refresh')
      }}</Button>
    </div>
    <p v-if="loading && !runs.length" role="status">{{ t('runs.loadingRuns') }}</p>
    <Empty v-else-if="!runs.length" role="status"
      ><EmptyDescription>{{ t('runs.noRuns') }}</EmptyDescription></Empty
    >
    <InfoChip
      v-if="lastRefreshed"
      :label="updatedLabel"
      :text="t('runs.listSnapshot', { time: lastRefreshed })"
    />
    <ul class="items">
      <li v-for="run in runs" :key="run.run_id" class="run-item">
        <button type="button" class="run-row" @click="$emit('select', run.run_id)">
          <span class="identity"
            ><strong>{{ t(runOperationMessageKeys[run.operation]) }}</strong
            ><small>{{ run.run_id }}</small></span
          >
        </button>
        <RunStateChip :run="run" :stale="staleRunIds?.has(run.run_id)" />
      </li>
    </ul>
    <div v-if="page > 0 || runs.length >= 50" class="toolbar" data-testid="run-pagination">
      <Button
        variant="outline"
        :disabled="loading || page === 0"
        @click="$emit('page', Math.max(0, page - 50))"
      >
        {{ t('runs.previous') }}</Button
      ><span>{{ t('runs.page', { page: Math.floor(page / 50) + 1 }) }}</span
      ><Button
        variant="outline"
        :disabled="loading || runs.length < 50"
        @click="$emit('page', page + 50)"
      >
        {{ t('runs.next') }}
      </Button>
    </div>
  </section>
</template>
<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  min-width: 0;
}
.run-list {
  min-width: 0;
  max-width: 100%;
}
.heading {
  font-size: 1.2rem;
}
.items {
  list-style: none;
  padding: 0;
  min-width: 0;
}
.run-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--border);
}
.run-row {
  flex: 1 1 12rem;
  min-width: 0;
  max-width: 100%;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  text-align: left;
  padding: 1rem 0.5rem;
  height: auto;
  white-space: normal;
  border-radius: 0.5rem;
  cursor: pointer;
}
.run-row:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
.identity {
  display: grid;
  gap: 0.3rem;
  min-width: 0;
}
.identity small {
  overflow-wrap: anywhere;
  color: var(--muted-foreground);
}
</style>
