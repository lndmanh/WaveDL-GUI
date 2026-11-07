<script setup lang="ts">
import type { ConnectionSession } from '../../lib/connection-session';
import type { RunMonitorSnapshot } from '~~/types/run-monitor';

const { t } = useI18n({ useScope: 'global' });

const props = defineProps<{
  session: ConnectionSession;
  runId: string | null;
  monitor?: RunMonitorSnapshot | null;
}>();

const emit = defineEmits<{ runSelected: [runId: string] }>();
const {
  session,
  connected,
  scopeGeneration,
  inventory,
  busy,
  message,
  downloadStatus,
  imageUrl,
  previewPath,
  refresh,
  consume,
  clearImage,
} = useRunArtifacts(() => props.session, () => props.runId);
</script>
<template>
  <section class="flex min-w-0 flex-col gap-6" aria-labelledby="results-title">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 id="results-title" class="text-xl font-semibold">
          {{ t('results.publishedResults') }}
        </h2>
        <InfoChip :label="t('results.exactIdentity')" :text="t('results.resultsHelp')" />
      </div>
      <div class="flex flex-wrap gap-2">
        <Button
          data-testid="results-refresh"
          variant="outline"
          :disabled="!runId || busy || !session.api"
          @click="refresh"
          >{{ busy ? t('results.working') : t('results.refresh') }}</Button>
      </div>
    </div>
    <Alert v-if="message"
      ><AlertTitle>{{ t('results.artifactStatus') }}</AlertTitle
      ><AlertDescription>{{ t(message) }}</AlertDescription></Alert
    >
    <p v-if="downloadStatus" role="status" class="text-sm text-muted-foreground">
      {{ t(downloadStatus) }}
    </p>
    <p v-if="!runId" class="text-muted-foreground">{{ t('results.selectExperiment') }}</p>
    <EvaluationResultsPanel
      v-if="connected && monitor && monitor.run?.run_id === runId"
      :run="monitor.run"
      :events="monitor.events"
      :freshness="monitor.freshness"
    />
    <ArtifactList
      :artifacts="inventory.files"
      :busy="busy"
      :image-url="imageUrl"
      :preview-path="previewPath"
      @download="consume"
      @preview="consume($event, true)"
      @close-preview="clearImage"
    />
    <CvSummaryPanel
      v-if="connected"
      :key="scopeGeneration"
      :session="session"
      :artifacts="inventory.files"
    />
    <ResultOperationForm
      v-if="runId && inventory.checkpoints.length"
      :key="`${runId}:${scopeGeneration}`"
      :session="session"
      :checkpoints="inventory.checkpoints"
      @run-selected="emit('runSelected', $event)"
    />
  </section>
</template>
