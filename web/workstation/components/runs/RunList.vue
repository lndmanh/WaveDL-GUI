<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { runMessages } from '../../i18n/runs';
import type { RunView } from '../../lib/daemon-api';
import { Button } from '@/components/ui/button';
import StateBadge from './StateBadge.vue';
const { t, translateKnownMessage } = useWorkstationI18n(runMessages);
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
  <section class="run-list" :aria-label="t('runs')">
    <div class="toolbar">
      <h2 class="heading">{{ t('runs') }}</h2>
      <Button variant="outline" :disabled="loading" @click="$emit('refresh')">{{
        t('refresh')
      }}</Button>
    </div>
    <p v-if="!runs.length">{{ loading ? t('loadingRuns') : t('noRuns') }}</p>
    <p v-if="lastRefreshed" class="text-muted-foreground text-xs">
      {{ t('listSnapshot', { time: lastRefreshed }) }}
    </p>
    <ul class="items">
      <li v-for="run in runs" :key="run.run_id">
        <Button variant="ghost" class="run-row" @click="$emit('select', run.run_id)">
          <span class="identity"
            ><strong>{{ translateKnownMessage(run.operation) }}</strong
            ><small>{{ run.run_id }}</small></span
          ><StateBadge :run="run" :stale="staleRunIds?.has(run.run_id)" />
        </Button>
      </li>
    </ul>
    <div class="toolbar">
      <Button
        variant="outline"
        :disabled="loading || page === 0"
        @click="$emit('page', Math.max(0, page - 50))"
      >
        {{ t('previous') }}</Button
      ><span>{{ t('page', { page: Math.floor(page / 50) + 1 }) }}</span
      ><Button
        variant="outline"
        :disabled="loading || runs.length < 50"
        @click="$emit('page', page + 50)"
      >
        {{ t('next') }}
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
