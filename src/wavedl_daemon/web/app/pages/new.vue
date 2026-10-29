<script setup lang="ts">
import { usePageActive } from '../composables/usePageActive';
import ProjectContainer from '../components/project/ProjectContainer.vue';
import { useWorkstation } from '../composables/useWorkstation';
import type { RunView } from '../lib/daemon-api';

defineOptions({ name: 'WorkstationNewPage' });
// The kept-alive root: descendants that mount while hidden inherit its state.
usePageActive();
const { api, session, monitorRun, automaticPlots } = useWorkstation();
function submitted(run: RunView): void {
  void monitorRun(run.run_id);
}
</script>

<template>
  <div data-work-page="project">
    <ProjectContainer
      v-show="!!api"
      :session="session"
      @submitted="submitted"
      @submitted-plan="automaticPlots.capture"
    />
  </div>
</template>
