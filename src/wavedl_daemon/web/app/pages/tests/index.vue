<script setup lang="ts">
defineOptions({ name: 'WorkstationTestsPage' });
usePageActive();

definePageMeta({
  key: 'tests',
  title: 'shell.tests',
  breadcrumb: 'shell.tests',
  fullWidth: true,
  fillHeight: true,
});

const { state, api, reportFailure } = useWorkstation();
</script>

<template>
  <ShellPage :panel-tabs="[]" data-work-page="tests">
    <TestsWorkspace
      v-if="!!api"
      :key="`${state.health?.daemon_id}:${state.revision}`"
      :api="api"
      @connection-error="reportFailure"
    />
  </ShellPage>
</template>
