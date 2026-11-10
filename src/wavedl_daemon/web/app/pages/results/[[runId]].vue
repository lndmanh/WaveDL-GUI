<script setup lang="ts">
import { DaemonApiError } from '../../lib/daemon-api';
import { isTestRun, testLocation } from '../../lib/test-runs';

defineOptions({ name: 'WorkstationResultsPage' });

// The kept-alive root: descendants that mount while hidden inherit its state.
const { isActive } = usePageActive();

definePageMeta({
  key: 'results',
  title: 'shell.results',
  breadcrumb: 'shell.results',
  fullWidth: true,
  fillHeight: true,
});

const { state, api, session, reportFailure } = useWorkstation();
const { runId, select, unknown } = useRunRoute('results');

watch(
  [runId, api, isActive, () => state.value.revision, () => state.value.health?.daemon_id],
  async ([id, client, active], _prior, onCleanup) => {
    if (!id || !client || !active) return;
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    const failure = reportFailure.value;

    try {
      const run = await client.getRun(
        id,
        AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      );

      if (!controller.signal.aborted && isActive.value && isTestRun(run)) {
        await navigateTo(testLocation(run), { replace: true });
      }
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
  <ShellPage :panel-tabs="[]" data-work-page="results">
    <ResultsContainer
      v-if="!!api"
      :key="`${state.health?.daemon_id}:${state.revision}`"
      :session="session"
      :api="api"
      :run-id="runId"
      @select="select"
      @connection-error="reportFailure"
    />
  </ShellPage>
</template>
