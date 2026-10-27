<script setup lang="ts">
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useI18n } from 'vue-i18n';

defineProps<{ visible: boolean }>();
const { t } = useI18n({ useScope: 'global' });

function reload(): void {
  location.reload();
}
</script>

<template>
  <Alert v-if="visible" class="build-skew-prompt" role="status" aria-live="polite">
    <AlertTitle>{{ t('shell.updateAvailable') }}</AlertTitle>
    <AlertDescription>
      <Button type="button" size="sm" @click="reload">{{ t('shell.reload') }}</Button>
    </AlertDescription>
  </Alert>
</template>

<style scoped>
.build-skew-prompt {
  margin: 32px auto 0;
  max-width: 660px;
}
</style>
