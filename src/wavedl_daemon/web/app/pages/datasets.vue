<script setup lang="ts">
definePageMeta({
  title: 'shell.datasets',
  breadcrumb: 'shell.datasets',
  fullWidth: true,
  fillHeight: true,
});

defineOptions({ name: 'WorkstationDatasetsPage' });

// The kept-alive root: descendants that mount while hidden inherit its state.
usePageActive();

const { state, api, session } = useWorkstation();
</script>

<template>
  <ShellPage :panel-tabs="[]" data-work-page="datasets">
    <DatasetsWorkspace
      v-if="!!api"
      :key="`${state.health?.daemon_id}:${state.revision}`"
      :session="session"
    />
  </ShellPage>
</template>
