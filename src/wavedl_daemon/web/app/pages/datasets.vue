<script setup lang="ts">
import DatasetsWorkspace from '../components/datasets/DatasetsWorkspace.vue';
import { useWorkstation } from '../composables/useWorkstation';

defineOptions({ name: 'WorkstationDatasetsPage' });
const { state, api, session } = useWorkstation();
</script>

<template>
  <div data-work-page="datasets">
    <DatasetsWorkspace
      v-if="!!api"
      :key="`datasets:${state.revision}`"
      :session="session"
    />
  </div>
</template>
