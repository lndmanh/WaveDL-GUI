<script setup lang="ts">
import { watch } from 'vue';
import { definePageMeta } from '#imports';
import ResultsContainer from '../../components/results/ResultsContainer.vue';
import { useWorkstation } from '../../composables/useWorkstation';
import { useRunRoute } from '../../composables/useRunRoute';
import { DaemonApiError } from '../../lib/daemon-api';

defineOptions({ name: 'WorkstationResultsPage' });
definePageMeta({ key: 'results' });
const { state, api, session, reportFailure, monitorRun } = useWorkstation();
const { runId, unknown } = useRunRoute('results');
watch(
  [runId, api, () => state.value.revision, () => state.value.health?.daemon_id],
  async ([id, client], _prior, onCleanup) => {
    if (!id || !client) return;
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    const failure = reportFailure.value;
    try {
      await client.getRun(id, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof DaemonApiError) {
        if (error.code === 'http' && error.status === 404) unknown(id);
        else failure(error);
      }
    }
  },
  { immediate: true },
);
</script>

<template>
  <div data-work-page="results">
    <ResultsContainer
      v-if="!!api"
      :key="`${state.health?.daemon_id}:${state.revision}`"
      :session="session"
      :run-id="runId"
      @run-selected="monitorRun"
    />
  </div>
</template>
