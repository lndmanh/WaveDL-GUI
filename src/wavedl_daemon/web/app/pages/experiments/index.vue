<script setup lang="ts">
import RunsWorkspace from '../../components/runs/RunsWorkspace.vue';
import { useWorkstation } from '../../composables/useWorkstation';

defineOptions({ name: 'WorkstationExperimentsPage' });
const { state, api, submittedRun, reportFailure } = useWorkstation();
</script>

<template>
  <div data-work-page="experiments">
    <RunsWorkspace
      v-if="!!api"
      :key="`${state.health?.daemon_id}:${state.revision}`"
      :api="api"
      :initial-run-id="submittedRun"
      @connection-error="reportFailure"
      @run-selected="submittedRun = $event"
    />
  </div>
</template>
