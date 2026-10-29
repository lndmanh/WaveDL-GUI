<script setup lang="ts">
import ProjectContainer from '../components/project/ProjectContainer.vue';
import { useWorkstation } from '../composables/useWorkstation';

defineOptions({ name: 'WorkstationNewPage' });
const { api, session, submitted, automaticPlots } = useWorkstation();
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
