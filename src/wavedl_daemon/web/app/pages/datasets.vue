<script setup lang="ts">
import { usePageActive } from '../composables/usePageActive';
import DatasetsWorkspace from '../components/datasets/DatasetsWorkspace.vue';
import { useWorkstation } from '../composables/useWorkstation';

defineOptions({ name: 'WorkstationDatasetsPage' });
// The kept-alive root: descendants that mount while hidden inherit its state.
usePageActive();
const { state, api, session } = useWorkstation();
</script>

<template>
  <div data-work-page="datasets">
    <DatasetsWorkspace
      v-if="!!api"
      :key="`${state.health?.daemon_id}:${state.revision}`"
      :session="session"
    />
  </div>
</template>
