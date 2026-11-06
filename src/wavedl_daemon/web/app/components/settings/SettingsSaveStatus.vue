<script setup lang="ts">
import { Check, CircleAlert, LoaderCircle } from '@lucide/vue';
import type { AutosaveStatus } from '~~/types/common';

defineProps<{ status: AutosaveStatus }>();
const { t } = useI18n({ useScope: 'global' });
</script>

<template>
  <p
    role="status"
    aria-live="polite"
    aria-atomic="true"
    class="flex min-h-5 items-center gap-1.5 text-xs text-muted-foreground"
    :class="status === 'error' ? 'text-destructive' : ''"
  >
    <template v-if="status === 'saving'">
      <LoaderCircle class="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
      {{ t('shell.settingsSaving') }}
    </template>
    <template v-else-if="status === 'saved'">
      <Check class="size-3.5" aria-hidden="true" />
      {{ t('shell.settingsSaved') }}
    </template>
    <template v-else-if="status === 'error'">
      <CircleAlert class="size-3.5 shrink-0" aria-hidden="true" />
      {{ t('shell.settingsSaveFailed') }}
    </template>
  </p>
</template>
