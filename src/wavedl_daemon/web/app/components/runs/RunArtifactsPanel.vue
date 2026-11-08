<script setup lang="ts">
import type { ArtifactImages } from '../../composables/useArtifactImages';
import type { RunArtifacts } from '../../composables/useRunArtifacts';
import type { Artifact } from '~~/types/artifact-client';

const props = defineProps<{
  runId: string;
  active: boolean;
  resources?: RunArtifacts;
  images?: ArtifactImages;
}>();

const emit = defineEmits<{ preview: [artifact: Artifact] }>();
const { t } = useI18n({ useScope: 'global' });
const { session } = useWorkstation();

// The run detail shares these resources with its evaluation scorecard.
const resources =
  props.resources ??
  useRunArtifacts(
    session,
    () => props.runId,
    () => props.active,
  );

const { connected, scopeGeneration, inventory, busy, message, downloadStatus, refresh, consume } =
  resources;

const images = props.images ?? useArtifactImages(() => (props.active ? props.runId : null));

const selectedImage = shallowRef<Artifact | null>(null);

const shownFiles = new Set<string>();

watch(
  [scopeGeneration, () => props.active],
  () => {
    selectedImage.value = null;
  },
  { flush: 'sync' },
);

function preview(artifact: Artifact) {
  if (props.resources) emit('preview', artifact);
  else selectedImage.value = artifact;
}
</script>

<template>
  <section class="flex min-w-0 flex-col gap-4" :aria-label="t('shell.artifacts')">
    <div class="flex justify-end">
      <Button
        type="button"
        variant="outline"
        size="sm"
        :disabled="!connected || busy"
        @click="refresh"
      >
        {{ busy ? t('results.working') : t('results.refresh') }}
      </Button>
    </div>
    <Alert v-if="message" role="status">
      <AlertTitle>{{ t('results.artifactStatus') }}</AlertTitle>
      <AlertDescription>{{ t(message) }}</AlertDescription>
    </Alert>
    <p v-if="downloadStatus" role="status" class="text-sm text-muted-foreground">
      {{ t(downloadStatus) }}
    </p>
    <ArtifactList
      v-if="active"
      :key="runId"
      :artifacts="inventory.files"
      :busy="busy"
      :images="images"
      :animate-entry="!shownFiles.has(runId)"
      @download="consume"
      @preview="preview"
      @vue:mounted="shownFiles.add(runId)"
    />
    <ArtifactLightbox
      v-if="!props.resources"
      :artifacts="inventory.files"
      :images="images"
      :selected="selectedImage"
      @close="selectedImage = null"
      @download="consume"
    />
  </section>
</template>
