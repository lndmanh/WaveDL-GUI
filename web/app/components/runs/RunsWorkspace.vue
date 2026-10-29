<script setup lang="ts">
import { useClientMessages } from '../../composables/useClientMessages';
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue';
import { MotionConfig } from 'motion-v';
import { useElementSize, useNow } from '@vueuse/core';
import { CircleAlert } from '@lucide/vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DaemonApi, DaemonApiError } from '../../lib/daemon-api';
import type { RunFilter } from '../../lib/run-overview';
import { useRuns } from '../../composables/useRuns';
import RunList from './RunList.vue';
import RunDetail from './RunDetail.vue';
import RunOverview from './RunOverview.vue';
const { clientMessage } = useClientMessages();
const props = defineProps<{ api: DaemonApi; initialRunId?: string | null }>();
const emit = defineEmits<{
  connectionError: [error: DaemonApiError];
  runSelected: [runId: string];
}>();
const {
  runs,
  selected,
  loading,
  message,
  page,
  staleRunIds,
  lastRefreshed,
  refresh,
  select,
  replay,
  cancel,
  close,
} = useRuns(props.api, (error) => emit('connectionError', error));
const root = useTemplateRef<HTMLElement>('root');
const stage = useTemplateRef<HTMLElement>('stage');
const { width } = useElementSize(root);
// Zero until measured: keep the split layout rather than flashing the stacked one.
const stacked = computed(() => width.value > 0 && width.value < 720);
const now = useNow({ interval: 30_000 });
const query = shallowRef('');
const filter = shallowRef<RunFilter>('all');
// The monitor's run id, known before its first snapshot arrives.
const activeRunId = shallowRef<string | null>(null);
function open(runId: string) {
  activeRunId.value = runId;
  select(runId);
}
/** Stacked layouts move the reader to the detail they asked for. */
async function choose(runId: string) {
  open(runId);
  if (!stacked.value) return;
  await nextTick();
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  stage.value?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
}
function dismiss() {
  activeRunId.value = null;
  close();
}
watch(
  () => props.initialRunId,
  (runId) => {
    if (runId) open(runId);
  },
  { immediate: true },
);
watch(
  () => selected.value?.run?.run_id,
  (runId) => {
    if (runId) emit('runSelected', runId);
  },
);
</script>
<template>
  <div ref="root" class="runs-workspace" :data-stacked="stacked ? 'true' : undefined">
    <MotionConfig reduced-motion="user">
      <Alert v-if="message" variant="warning" role="status" class="runs-message">
        <CircleAlert aria-hidden="true" />
        <AlertDescription>{{ clientMessage(message) }}</AlertDescription>
      </Alert>
      <RunList
        v-model:query="query"
        v-model:filter="filter"
        class="runs-sidebar"
        :runs="runs"
        :loading="loading"
        :page="page"
        :stale-run-ids="staleRunIds"
        :last-refreshed="lastRefreshed"
        :selected-run-id="selected ? activeRunId : null"
        :now="now"
        @refresh="refresh()"
        @page="refresh"
        @select="choose"
      />
      <div ref="stage" class="runs-stage">
        <RunDetail
          v-if="selected"
          :key="activeRunId ?? 'run'"
          :snapshot="selected"
          :now="now"
          @cancel="cancel"
          @replay="replay"
          @close="dismiss"
        />
        <RunOverview v-else :runs="runs" :loading="loading" :now="now" @select="choose" />
      </div>
    </MotionConfig>
  </div>
</template>
<style scoped>
.runs-workspace {
  display: grid;
  grid-template-columns: minmax(16rem, 22rem) minmax(0, 1fr);
  align-items: start;
  gap: 1.5rem;
  min-width: 0;
  max-width: 88rem;
  margin-inline: auto;
}
.runs-workspace > * {
  min-width: 0;
  max-width: 100%;
}
.runs-message {
  grid-column: 1 / -1;
}
/* The sidebar keeps its place while the detail scrolls the canvas. */
.runs-sidebar {
  position: sticky;
  top: 0;
  max-height: calc(100dvh - 9rem);
}
.runs-stage {
  min-width: 0;
  scroll-margin-top: 1rem;
}
.runs-workspace[data-stacked='true'] {
  grid-template-columns: minmax(0, 1fr);
}
.runs-workspace[data-stacked='true'] .runs-sidebar {
  position: static;
  max-height: min(32rem, 70dvh);
}
</style>
