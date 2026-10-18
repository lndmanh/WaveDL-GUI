<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { runMessages } from '../../i18n/runs';
import { computed } from 'vue';
import type { RunEvent } from '../../lib/event-stream';
import { eventDiagnostic } from '../../lib/run-monitor';
const { t } = useWorkstationI18n(runMessages);
const props = defineProps<{ events: readonly RunEvent[]; truncated: boolean }>();
const diagnostics = computed(() => props.events.map(eventDiagnostic));
const text = computed(() => diagnostics.value.map((event) => event.text).join('\n'));
const shortened = computed(() => diagnostics.value.some((event) => event.truncated));
</script>
<template>
  <section class="logs" :aria-label="t('runtimeDiagnostics')">
    <h3>{{ t('runtimeDiagnostics') }}</h3>
    <p v-if="truncated">
      {{ t('omittedDiagnostics') }}
    </p>
    <p v-if="shortened">{{ t('shortenedDiagnostics') }}</p>
    <pre
      class="log-text"
      role="log"
      tabindex="0"
      aria-live="off"
      :aria-label="t('runtimeDiagnostics')"
      >{{ text || t('noEvents') }}</pre>
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
