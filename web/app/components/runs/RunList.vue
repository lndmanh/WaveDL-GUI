<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { RunView } from '../../lib/daemon-api';
import { Button } from '@/components/ui/button';
import RunStateChip from './RunStateChip.vue';
import InfoChip from '../common/InfoChip.vue';
import { runOperationMessageKeys } from '../../i18n/dynamic-keys';
const { t } = useI18n({ useScope: 'global' });
defineProps<{
  runs: readonly RunView[];
  loading: boolean;
  page: number;
  staleRunIds?: ReadonlySet<string>;
  lastRefreshed?: string | null;
}>();
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
    <p v-if="!runs.length">{{ loading ? t('runs.loadingRuns') : t('runs.noRuns') }}</p>
    <InfoChip
      v-if="lastRefreshed"
      :label="lastRefreshed"
      :text="t('runs.listSnapshot', { time: lastRefreshed })"
    />
    <ul class="items">
      <li v-for="run in runs" :key="run.run_id">
        <Button variant="ghost" class="run-row" @click="$emit('select', run.run_id)">
          <span class="identity"
            ><strong>{{ t(runOperationMessageKeys[run.operation]) }}</strong
            ><small>{{ run.run_id }}</small></span
          ><RunStateChip :run="run" :stale="staleRunIds?.has(run.run_id)" />
        </Button>
      </li>
    </ul>
    <div class="toolbar">
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
}
.heading {
  font-size: 1.2rem;
}
.items {
  list-style: none;
  padding: 0;
}
.run-row {
  width: 100%;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  text-align: left;
  padding: 1rem 0.5rem;
  height: auto;
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
