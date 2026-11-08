<script setup lang="ts">
import { CircleAlert, LoaderCircle } from '@lucide/vue';
import type { ArtifactImages } from '../../composables/useArtifactImages';
import type { Artifact } from '~~/types/artifact-client';

const props = defineProps<{
  artifact: Artifact;
  images: ArtifactImages;
  alt: string;
}>();

const { t } = useI18n({ useScope: 'global' });
const root = useTemplateRef<HTMLElement>('root');
const visible = shallowRef(false);
const image = computed(() => props.images.state(props.artifact));

useIntersectionObserver(
  root,
  ([entry]) => {
    visible.value = entry?.isIntersecting ?? false;
  },
  { rootMargin: '160px' },
);

watchEffect(() => {
  if (visible.value && image.value.status === 'idle') void props.images.request(props.artifact);
});

function retry(event: Event) {
  if (image.value.status !== 'error') return;
  event.stopPropagation();
  event.preventDefault();
  void props.images.request(props.artifact, { retry: true, priority: true });
}
</script>

<template>
  <div
    ref="root"
    class="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-md"
    :class="image.status === 'ready' ? 'bg-white' : 'bg-muted/50'"
    :aria-busy="image.status === 'loading'"
    @click="retry"
  >
    <img
      v-if="image.status === 'ready' && image.url"
      :src="image.url"
      :alt="alt"
      :width="image.width"
      :height="image.height"
      decoding="async"
      class="h-full w-full object-contain"
    />
    <div
      v-else-if="image.status === 'error'"
      class="flex max-w-full flex-col items-center gap-2 p-4 text-center text-xs text-muted-foreground"
      role="status"
    >
      <CircleAlert class="size-5" aria-hidden="true" />
      <span>{{ t('results.imageFailed') }}</span>
      <span class="font-medium text-foreground underline underline-offset-4">{{
        t('results.retryImage')
      }}</span>
    </div>
    <template v-else>
      <Skeleton class="absolute inset-0 rounded-none motion-reduce:animate-none" />
      <LoaderCircle
        class="relative size-5 animate-spin text-muted-foreground motion-reduce:animate-none"
        aria-hidden="true"
      />
      <span class="sr-only">{{ t('results.imageLoading') }}</span>
    </template>
  </div>
</template>
