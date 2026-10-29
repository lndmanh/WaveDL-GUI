<script setup lang="ts">
import { definePageMeta } from '#imports';
import { useWorkstation } from '../composables/useWorkstation';
import SettingsWorkspace from '../components/settings/SettingsWorkspace.vue';

definePageMeta({ keepalive: false });
const { state, appearance, appearanceChanged } = useWorkstation();
</script>

<template>
  <div class="flex min-h-full flex-1 flex-col p-6" data-settings-page>
    <SettingsWorkspace
      :daemon-id="state.health?.daemon_id ?? null"
      :appearance="appearance"
      @appearance-changed="appearanceChanged"
    />
  </div>
</template>
