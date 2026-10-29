<script setup lang="ts">
import { definePageMeta } from '#imports';
import RunsWorkspace from '../../components/runs/RunsWorkspace.vue';
import { useWorkstation } from '../../composables/useWorkstation';
import { useRunRoute } from '../../composables/useRunRoute';

defineOptions({ name: 'WorkstationExperimentsPage' });
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
