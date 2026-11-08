<script setup lang="ts">
import { Image, Maximize2 } from '@lucide/vue';
import { artifactPlotLabel } from '../../lib/artifact-plots';
import { pathName } from '../../lib/run-overview';
import type { ArtifactImages } from '../../composables/useArtifactImages';
import type { Artifact } from '~~/types/artifact-client';

const props = defineProps<{
  artifacts: readonly Artifact[];
  images: ArtifactImages;
  hasParameters: boolean;
}>();

const emit = defineEmits<{ preview: [artifact: Artifact] }>();
const { t } = useI18n({ useScope: 'global' });

const plots = computed(() =>
  props.artifacts
    .filter((artifact) => artifact.path.toLowerCase().endsWith('.png'))
    .map((artifact) => {
      const label = artifactPlotLabel(artifact.path);

      return {
        artifact,
        name: pathName(artifact.path),
        title: label ? t(label.key, label.params ?? {}) : pathName(artifact.path),
      };
    }),
);

const featured = computed(
  () => plots.value.find((plot) => plot.name === 'scatter_all.png') ?? plots.value[0] ?? null,
);

const remaining = computed(() => plots.value.filter((plot) => plot !== featured.value));
</script>

<template>
  <div class="flex min-w-0 flex-col gap-5">
    <div
      class="grid items-start gap-4"
      :class="hasParameters ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]' : ''"
    >
      <slot />
      <figure v-if="featured" class="min-w-0 overflow-hidden rounded-xl border bg-card">
        <div class="flex items-center justify-between gap-2 px-4 py-3">
          <figcaption class="text-sm font-semibold">{{ featured.title }}</figcaption>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="size-8 shrink-0"
            :aria-label="t('results.scorecard.previewPlot', { name: featured.title })"
            @click="emit('preview', featured.artifact)"
            ><Maximize2 class="size-4" aria-hidden="true"
          /></Button>
        </div>
        <button
          type="button"
          class="block w-full cursor-zoom-in border-t text-left focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
          :aria-label="t('results.scorecard.previewPlot', { name: featured.title })"
          @click="emit('preview', featured.artifact)"
        >
          <ArtifactImage :artifact="featured.artifact" :images="images" :alt="featured.title" />
        </button>
      </figure>
      <div
        v-else
        class="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-8 text-center text-muted-foreground"
        role="status"
      >
        <Image class="size-6" aria-hidden="true" />
        <p class="max-w-sm text-sm">{{ t('results.scorecard.noPlots') }}</p>
      </div>
    </div>
    <section
      v-if="remaining.length"
      class="flex flex-col gap-3"
      :aria-label="t('results.scorecard.plotsTitle')"
    >
      <h4 class="text-sm font-semibold">{{ t('results.scorecard.plotsTitle') }}</h4>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <button
          v-for="plot in remaining"
          :key="plot.artifact.path"
          type="button"
          class="group flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          :aria-label="t('results.scorecard.previewPlot', { name: plot.title })"
          @click="emit('preview', plot.artifact)"
        >
          <ArtifactImage :artifact="plot.artifact" :images="images" :alt="plot.title" />
          <span class="flex w-full min-w-0 flex-col gap-0.5 border-t px-3 py-2">
            <span class="truncate text-sm font-medium">{{ plot.title }}</span>
            <span class="truncate font-mono text-xs text-muted-foreground">{{ plot.name }}</span>
          </span>
        </button>
      </div>
    </section>
  </div>
</template>
