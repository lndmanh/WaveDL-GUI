<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed } from 'vue';
import type { RunEvent } from '../../lib/event-stream';
import { eventDiagnostic } from '../../lib/run-monitor';
import InfoChip from '../common/InfoChip.vue';
const { t } = useI18n({ useScope: 'global' });
const props = defineProps<{ events: readonly RunEvent[]; truncated: boolean; panel?: boolean }>();
const diagnostics = computed(() => props.events.map(eventDiagnostic));
const text = computed(() => diagnostics.value.map((event) => event.text).join('\n'));
const shortened = computed(() => diagnostics.value.some((event) => event.truncated));
</script>
<template>
  <section class="logs" :class="{ 'logs-panel': panel }" :aria-label="t('runs.runtimeDiagnostics')">
    <h3>{{ t('runs.runtimeDiagnostics') }}</h3>
    <InfoChip
      v-if="truncated"
      :label="t('runs.boundedDiagnostics')"
      :text="t('runs.omittedDiagnostics')"
      uncertain
    />
    <InfoChip
      v-if="shortened"
      :label="t('runs.shortDiagnostics')"
      :text="t('runs.shortenedDiagnostics')"
    />
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
.logs {
  min-width: 0;
}
.logs-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  height: 100%;
  min-height: 0;
}
.logs-panel .log-text {
  max-height: none;
  flex: 1;
  min-height: 0;
}
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
