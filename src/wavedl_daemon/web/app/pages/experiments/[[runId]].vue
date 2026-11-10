<script setup lang="ts">
import { SHELL_PANEL_TABS } from '../../shell/constants';

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
const { runId, select, unknown, redirectTest } = useRunRoute('experiments', isActive);
const planned = shallowRef(false);
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
      @run-loaded="redirectTest"
      @select="select"
      @unknown-run="unknown"
      @planned="planned = $event"
    />
  </ShellPage>
</template>
