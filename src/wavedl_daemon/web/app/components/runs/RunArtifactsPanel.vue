<script setup lang="ts">
const props = defineProps<{ runId: string; active: boolean }>();
const { t } = useI18n({ useScope: 'global' });
const { session } = useWorkstation();
const {
  connected,
  inventory,
  busy,
  message,
  downloadStatus,
  imageUrl,
  previewPath,
  refresh,
  consume,
  clearImage,
} = useRunArtifacts(session, () => props.runId, () => props.active);
</script>

<template>
  <section class="flex min-w-0 flex-col gap-4" :aria-label="t('shell.artifacts')">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="text-sm font-semibold">{{ t('results.publications') }}</h3>
      <Button type="button" variant="outline" size="sm" :disabled="!connected || busy" @click="refresh">
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
      :artifacts="inventory.files"
      :busy="busy"
      :image-url="imageUrl"
      :preview-path="previewPath"
      @download="consume"
      @preview="consume($event, true)"
      @close-preview="clearImage"
    />
  </section>
</template>
