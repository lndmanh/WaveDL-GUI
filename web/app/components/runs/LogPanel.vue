<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed } from 'vue';
import type { RunEvent } from '../../lib/event-stream';
import { eventDiagnostic } from '../../lib/run-monitor';
const { t } = useI18n({ useScope: 'global' });
const props = defineProps<{ events: readonly RunEvent[]; truncated: boolean }>();
const diagnostics = computed(() => props.events.map(eventDiagnostic));
const text = computed(() => diagnostics.value.map((event) => event.text).join('\n'));
const shortened = computed(() => diagnostics.value.some((event) => event.truncated));
</script>
<template>
  <section class="logs" :aria-label="t('runs.runtimeDiagnostics')">
    <h3>{{ t('runs.runtimeDiagnostics') }}</h3>
    <p v-if="truncated">
      {{ t('runs.omittedDiagnostics') }}
    </p>
    <p v-if="shortened">{{ t('runs.shortenedDiagnostics') }}</p>
    <pre
      class="log-text"
      role="log"
      tabindex="0"
      aria-live="off"
      :aria-label="t('runs.runtimeDiagnostics')"
      >{{ text || t('runs.noEvents') }}</pre>
  </section>
</template>
<style scoped>
.log-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 26rem;
  overflow: auto;
  font:
    0.8rem/1.6 ui-monospace,
    monospace;
  padding: 1rem;
  background: var(--muted);
  border-radius: 0.75rem;
}
</style>
