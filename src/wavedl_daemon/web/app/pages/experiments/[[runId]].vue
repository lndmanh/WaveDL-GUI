<script setup lang="ts">
import { SHELL_PANEL_TABS } from '../../shell/constants';
import { DaemonApiError } from '../../lib/daemon-api';
import { isTestRun, testLocation } from '../../lib/test-runs';

defineOptions({ name: 'WorkstationExperimentsPage' });

// The kept-alive root: descendants that mount while hidden inherit its state.
const { isActive } = usePageActive();

definePageMeta({
  key: 'experiments',
  title: 'shell.experiments',
  breadcrumb: 'shell.experiments',
  fullWidth: true,
  fillHeight: true,
});

const { state, api, reportFailure } = useWorkstation();
const { runId, select, unknown } = useRunRoute('experiments');
const planned = shallowRef(false);

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
  <ShellPage
    :panel-tabs="runId && api && !planned ? SHELL_PANEL_TABS : []"
    data-work-page="experiments"
  >
    <RunsWorkspace
      v-if="!!api"
      :key="`${state.health?.daemon_id}:${state.revision}`"
      :api="api"
      :run-id="runId"
      @connection-error="reportFailure"
      @select="select"
      @unknown-run="unknown"
      @planned="planned = $event"
    />
  </ShellPage>
</template>
