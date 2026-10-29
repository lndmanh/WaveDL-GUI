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
import { usePageActive } from '../../composables/usePageActive';
const { clientMessage } = useClientMessages();
const props = defineProps<{ api: DaemonApi; runId: string | null }>();
const emit = defineEmits<{
  connectionError: [error: DaemonApiError];
  select: [runId: string | null];
  unknownRun: [runId: string];
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
  pause,
  resume,
} = useRuns(props.api, (error) => emit('connectionError', error), true);
const { isActive } = usePageActive(resume, pause);
const root = useTemplateRef<HTMLElement>('root');
const stage = useTemplateRef<HTMLElement>('stage');
const { width } = useElementSize(() => isActive.value ? root.value : null);
// Zero until measured: keep the split layout rather than flashing the stacked one.
const stacked = computed(() => width.value > 0 && width.value < 720);
const clock = useNow({ interval: 30_000, controls: true, immediate: false });
usePageActive(() => {
  clock.now.value = new Date();
  clock.resume();
}, clock.pause);
const now = clock.now;
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
  emit('select', runId);
  if (!stacked.value) return;
  await nextTick();
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  stage.value?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
}
function dismiss() {
  emit('select', null);
}
watch(
  () => props.runId,
  (runId) => {
    if (runId) open(runId);
    else {
      activeRunId.value = null;
      close();
    }
  },
  { immediate: true },
);
watch(
  () => selected.value?.message,
  (error) => {
    if (error instanceof DaemonApiError && error.code === 'http' && error.status === 404) {
      const id = activeRunId.value;
      close();
      if (id) emit('unknownRun', id);
    }
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
