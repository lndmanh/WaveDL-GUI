<script setup lang="ts">
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useWorkstationI18n } from '../composables/useWorkstationI18n';
import { shellSettingsMessages } from '../i18n/shell-settings';

defineProps<{ visible: boolean }>();
const { translateKnownMessage } = useWorkstationI18n(shellSettingsMessages);

function reload(): void {
  location.reload();
}
</script>

<template>
  <Alert v-if="visible" class="build-skew-prompt" role="status" aria-live="polite">
    <AlertTitle>{{ translateKnownMessage('A newer WaveDL build is available') }}</AlertTitle>
    <AlertDescription>
      <Button type="button" size="sm" @click="reload">{{ translateKnownMessage('Reload') }}</Button>
    </AlertDescription>
  </Alert>
</template>

<style scoped>
.build-skew-prompt {
  margin: 32px auto 0;
  max-width: 660px;
}
</style>
