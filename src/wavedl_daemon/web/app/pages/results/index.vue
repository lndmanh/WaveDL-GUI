<script setup lang="ts">
import ResultsContainer from '../../components/results/ResultsContainer.vue';
import { useWorkstation } from '../../composables/useWorkstation';

defineOptions({ name: 'WorkstationResultsPage' });
const { state, api, session, submittedRun, monitorRun } = useWorkstation();
</script>

<template>
  <div data-work-page="results">
    <ResultsContainer
      v-if="!!api"
      :key="`results:${state.revision}`"
      :session="session"
      :run-id="submittedRun"
      @run-selected="monitorRun"
    />
  </div>
</template>
