<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, onBeforeUnmount, shallowRef, watch, toRaw } from 'vue';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ConnectionSession } from '../../lib/connection-session';
import { ArtifactClient, pngPreviewBlob, type Artifact } from '../../lib/artifact-client';
import { artifactDownloadName } from '../../lib/artifact-download';
import ArtifactList from './ArtifactList.vue';
import CvSummaryPanel from './CvSummaryPanel.vue';
import ResultOperationForm from './ResultOperationForm.vue';
import EvaluationResultsPanel from './EvaluationResultsPanel.vue';
import type { RunMonitorSnapshot } from '../../lib/run-monitor';
const { t } = useI18n({ useScope: 'global' });
const props = defineProps<{
  session: ConnectionSession;
  runId: string | null;
  monitor?: RunMonitorSnapshot | null;
}>();
const session = computed(() => toRaw(props.session));
const connected = shallowRef(false);
const scopeGeneration = shallowRef(0);
const emit = defineEmits<{ runSelected: [runId: string] }>();
const artifacts = shallowRef<readonly Artifact[]>([]);
const busy = shallowRef(false);
const message = shallowRef('');
const downloadStatus = shallowRef('');
const imageUrl = shallowRef<string | null>(null);
let scope = new AbortController();
let epoch = 0;
function clearImage() {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
  imageUrl.value = null;
}
function reset() {
  scope.abort();
  scope = new AbortController();
  epoch++;
  scopeGeneration.value++;
  artifacts.value = [];
  busy.value = false;
  message.value = '';
  downloadStatus.value = '';
  clearImage();
}
watch(
  session,
  (owner, _prior, onCleanup) => {
    reset();
    let active = true;
    let revision = owner.snapshot().revision;
    const unsubscribe = owner.subscribe((state) => {
      if (!active || owner !== session.value) return;
      connected.value = state.status === 'connected';
      if (state.status !== 'connected' || revision !== state.revision) reset();
      revision = state.revision;
    });
    onCleanup(() => {
      active = false;
      unsubscribe();
    });
  },
  { immediate: true, flush: 'sync' },
);
watch(() => props.runId, reset, { flush: 'sync' });
async function refresh() {
  if (!props.runId || busy.value) return;
  const current = epoch;
  busy.value = true;
  message.value = '';
  try {
    const items = await new ArtifactClient(session.value).list(props.runId, scope.signal);
    if (current === epoch) artifacts.value = items;
  } catch {
    if (current === epoch) message.value = 'results.artifactsFailed';
  } finally {
    if (current === epoch) busy.value = false;
  }
}
async function consume(artifact: Artifact, preview = false) {
  if (busy.value) return;
  const current = epoch;
  busy.value = true;
  message.value = '';
  try {
    const blob = await new ArtifactClient(session.value).verifiedBlob(artifact, scope.signal);
    if (current !== epoch) return;
    if (preview) {
      const image = await pngPreviewBlob(blob);
      if (current !== epoch) return;
      clearImage();
      imageUrl.value = URL.createObjectURL(image);
    } else {
      const name = await artifactDownloadName(artifact, artifacts.value);
      if (current !== epoch) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      downloadStatus.value = 'results.downloadRequested';
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch {
    if (current === epoch)
      message.value =
        artifact.size > 64 * 1024 * 1024 ? 'results.budget' : 'results.verificationFailed';
  } finally {
    if (current === epoch) busy.value = false;
  }
}
onBeforeUnmount(() => {
  reset();
});
</script>
<template>
  <section class="flex min-w-0 flex-col gap-6" aria-labelledby="results-title">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 id="results-title" class="text-xl font-semibold">
          {{ t('results.publishedResults') }}
        </h2>
        <p class="text-sm text-muted-foreground">{{ t('results.resultsHelp') }}</p>
      </div>
      <Button variant="outline" :disabled="!runId || busy || !session.api" @click="refresh">{{
        busy ? t('results.working') : t('results.refresh')
      }}</Button>
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
      :artifacts="artifacts"
      :busy="busy"
      @download="consume"
      @preview="consume($event, true)"
    />
    <CvSummaryPanel
      v-if="connected"
      :key="scopeGeneration"
      :session="session"
      :artifacts="artifacts"
    />
    <ResultOperationForm
      v-if="runId && artifacts.length"
      :key="`${runId}:${scopeGeneration}`"
      :session="session"
      :artifacts="artifacts"
      @run-selected="emit('runSelected', $event)"
    />
    <figure v-if="imageUrl" class="flex flex-col gap-3">
      <img :src="imageUrl" :alt="t('results.verifiedPlot')" class="max-w-full" /><Button
        variant="outline"
        @click="clearImage"
        >{{ t('results.closePlot') }}</Button
      >
    </figure>
  </section>
</template>
