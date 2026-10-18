<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { useClientMessages } from '../../composables/useClientMessages';
import { runMessages } from '../../i18n/runs';
import { watch } from 'vue';
import { DaemonApi, DaemonApiError } from '../../lib/daemon-api';
import { useRuns } from '../../composables/useRuns';
import RunList from './RunList.vue';
import RunDetail from './RunDetail.vue';
const { translateKnownMessage } = useWorkstationI18n(runMessages);
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
watch(
  () => props.initialRunId,
  (runId) => {
    if (runId) select(runId);
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
  <div class="runs-workspace">
    <p v-if="message" role="status">{{ translateKnownMessage(clientMessage(message)) }}</p>
    <RunList
      :runs="runs"
      :loading="loading"
      :page="page"
      :stale-run-ids="staleRunIds"
      :last-refreshed="lastRefreshed"
      @refresh="refresh()"
      @page="refresh"
      @select="select"
    /><RunDetail
      v-if="selected"
      :snapshot="selected"
      @cancel="cancel"
      @replay="replay"
      @close="close"
    />
  </div>
</template>
<style scoped>
.runs-workspace {
  display: grid;
  grid-template-columns: minmax(15rem, 1fr) minmax(0, 2fr);
  gap: 2rem;
}
.runs-workspace > p {
  grid-column: 1 / -1;
}
@media (max-width: 800px) {
  .runs-workspace {
    grid-template-columns: 1fr;
  }
}
</style>
