<script setup lang="ts">
import { useWorkstationI18n } from '../composables/useWorkstationI18n';
import { shellSettingsMessages } from '../i18n/shell-settings';
import { useNuxtApp } from '#app';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const { $workstationUpdate } = useNuxtApp();
const state = $workstationUpdate.state;
const { translateKnownMessage } = useWorkstationI18n(shellSettingsMessages);
</script>

<template>
  <Alert v-if="state.available && !state.dismissed" class="update-prompt">
    <AlertTitle>{{
      state.installationRefusal === null
        ? translateKnownMessage('A workstation update is available')
        : translateKnownMessage('Workstation update blocked')
    }}</AlertTitle>
    <AlertDescription v-if="state.installationRefusal === 'capacity'">{{
      translateKnownMessage(
        'Update blocked by retained offline builds. Existing tabs remain loaded. Close all Workstation tabs, then use browser storage tools to unregister only the WaveDL service-worker registration for this origin and remove only its retained-build caches and database. Reopen Workstation while connected.',
      )
    }}</AlertDescription>
    <AlertDescription v-else-if="state.installationRefusal === 'verification'">{{
      translateKnownMessage(
        'Update verification failed. This tab has not reloaded. Restore the connection and reload explicitly to check again.',
      )
    }}</AlertDescription>
    <AlertDescription v-else>{{
      translateKnownMessage(
        'Reload this tab only when you are ready. Another tab may activate the shared worker, but cannot reload this tab.',
      )
    }}</AlertDescription>
    <div class="update-actions">
      <Button
        v-if="state.installationRefusal === null"
        :disabled="state.updating"
        @click="$workstationUpdate.approve"
        >{{
          state.updating
            ? translateKnownMessage('Updating…')
            : translateKnownMessage('Update and reload')
        }}</Button
      >
      <Button variant="outline" :disabled="state.updating" @click="$workstationUpdate.defer">{{
        translateKnownMessage('Later')
      }}</Button>
    </div>
    <p v-if="state.failed && state.installationRefusal === null" role="alert">
      {{ translateKnownMessage('The update failed. Try again when connected.') }}
    </p>
  </Alert>
</template>

<style scoped>
.update-prompt {
  margin: 32px auto 0;
  max-width: 660px;
}
.update-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}
</style>
