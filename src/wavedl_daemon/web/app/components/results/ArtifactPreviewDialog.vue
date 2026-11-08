<script setup lang="ts">
import { Download, X } from '@lucide/vue';
import { pathName } from '../../lib/run-overview';
import type { Artifact } from '~~/types/artifact-client';

const props = defineProps<{
  artifact?: Artifact;
  busy: boolean;
  imageUrl?: string | null;
  previewPath?: string | null;
}>();

const emit = defineEmits<{
  download: [artifact: Artifact];
  closePreview: [];
  restoreFocus: [event: Event];
}>();

const { t } = useI18n({ useScope: 'global' });
const open = computed(() => Boolean(props.imageUrl && props.previewPath));
const name = computed(() => pathName(props.previewPath));

function updateOpen(value: boolean) {
  if (!value) emit('closePreview');
}

function download() {
  if (props.artifact && !props.busy) emit('download', props.artifact);
}
</script>

<template>
  <Dialog :open="open" @update:open="updateOpen">
    <DialogContent
      class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-4xl"
      :show-close-button="false"
      @close-auto-focus="emit('restoreFocus', $event)"
    >
      <DialogHeader class="min-w-0 pr-8 text-left">
        <DialogTitle class="wrap-anywhere">{{ name }}</DialogTitle>
        <DialogDescription class="wrap-anywhere">{{ previewPath }}</DialogDescription>
      </DialogHeader>
      <img
        v-if="imageUrl"
        :src="imageUrl"
        :alt="t('results.verifiedPlot')"
        class="max-h-[60dvh] w-full rounded-md object-contain"
      />
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          :disabled="busy || !artifact"
          :aria-label="t('results.downloadFile', { path: previewPath ?? '' })"
          @click="download"
        >
          <Download data-icon="inline-start" aria-hidden="true" />
          {{ t('results.download') }}
        </Button>
      </DialogFooter>
      <DialogClose as-child>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          class="absolute top-3 right-3"
          :aria-label="t('results.closePlot')"
          ><X aria-hidden="true"
        /></Button>
      </DialogClose>
    </DialogContent>
  </Dialog>
</template>
