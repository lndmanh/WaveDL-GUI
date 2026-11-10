<script setup lang="ts">
defineOptions({ name: 'WorkstationTestComparePage' });
usePageActive();
definePageMeta({
  key: 'test-compare',
  title: 'results.compare.pageTitle',
  breadcrumb: 'results.compare.pageTitle',
  fullWidth: true,
});
const { state, api } = useWorkstation();
</script>

<template>
  <ShellPage :panel-tabs="[]">
    <CompareWorkspace v-if="api" :key="`${state.health?.daemon_id}:${state.revision}`" :api="api" />
  </ShellPage>
</template>
