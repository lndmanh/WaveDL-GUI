<script setup lang="ts">
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
const { runId, select, unknown, redirectTest } = useRunRoute('results', isActive);
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
      @run-loaded="redirectTest"
      @unknown-run="unknown"
    />
  </ShellPage>
</template>
