<script setup lang="ts">
import { usePageActive } from '../../composables/usePageActive';
import { definePageMeta } from '#imports';
import RunsWorkspace from '../../components/runs/RunsWorkspace.vue';
import { useWorkstation } from '../../composables/useWorkstation';
import { useRunRoute } from '../../composables/useRunRoute';

defineOptions({ name: 'WorkstationExperimentsPage' });
// The kept-alive root: descendants that mount while hidden inherit its state.
usePageActive();
definePageMeta({ key: 'experiments' });
const { state, api, reportFailure } = useWorkstation();
const { runId, select, unknown } = useRunRoute('experiments');
</script>

<template>
  <div data-work-page="experiments">
    <RunsWorkspace
      v-if="!!api"
      :key="`${state.health?.daemon_id}:${state.revision}`"
      :api="api"
      :run-id="runId"
      @connection-error="reportFailure"
      @select="select"
      @unknown-run="unknown"
    />
  </div>
</template>
