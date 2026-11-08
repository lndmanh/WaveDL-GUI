<script setup lang="ts">
import type PhotoSwipe from 'photoswipe';
import type { SlideData } from 'photoswipe';
import { CircleAlert, LoaderCircle, RotateCcw } from '@lucide/vue';
import 'photoswipe/style.css';
import type { ArtifactImages } from '../../composables/useArtifactImages';
import { pathName } from '../../lib/run-overview';
import type { Artifact } from '~~/types/artifact-client';

const props = defineProps<{
  artifacts: readonly Artifact[];
  images: ArtifactImages;
  selected: Artifact | null;
}>();

const emit = defineEmits<{
  close: [];
  download: [artifact: Artifact];
}>();

const { t } = useI18n({ useScope: 'global' });
const reducedMotion = usePreferredReducedMotion();
const { isActive } = usePageActive();

const plots = computed(() =>
  props.artifacts.filter((artifact) => artifact.path.toLowerCase().endsWith('.png')),
);

const currentIndex = shallowRef(0);
const currentArtifact = computed(() => plots.value[currentIndex.value]);

const currentImage = computed(() =>
  currentArtifact.value ? props.images.state(currentArtifact.value) : null,
);

const target = shallowRef<HTMLElement | null>(null);
const captionTitleId = useId();
const captionPathId = useId();
const failed = shallowRef(false);
let viewer: PhotoSwipe | null = null;
let generation = 0;
let restoreTarget: HTMLElement | null = null;

function slideData(artifact: Artifact): SlideData {
  const state = props.images.state(artifact);

  if (state.status === 'ready' && state.url) {
    return {
      src: state.url,
      width: state.width,
      height: state.height,
      alt: pathName(artifact.path),
    };
  }

  return { type: 'html', html: '<div class="artifact-lightbox-placeholder"></div>' };
}

function destroy() {
  generation++;
  target.value = null;
  const prior = viewer;
  viewer = null;
  prior?.destroy();
}

function close() {
  destroy();
  failed.value = false;
  emit('close');
}

async function open() {
  destroy();
  failed.value = false;
  const selected = props.selected;
  const index = plots.value.findIndex((artifact) => artifact === selected);

  if (!selected || !isActive.value) return;

  if (index < 0) {
    emit('close');

    return;
  }

  const scope = generation;
  const focused = document.activeElement;
  restoreTarget = focused instanceof HTMLElement ? focused : null;
  currentIndex.value = index;
  void props.images.request(selected, { priority: true });

  try {
    const { default: PhotoSwipeConstructor } = await import('photoswipe');

    if (scope !== generation || props.selected !== selected || !isActive.value) return;
    const originals = plots.value;
    const dataSource = originals.map(slideData);

    const instance = new PhotoSwipeConstructor({
      dataSource,
      index,
      mainClass: 'artifact-lightbox',
      bgOpacity: 0.98,
      showHideAnimationType: reducedMotion.value === 'reduce' ? 'none' : 'fade',
      showAnimationDuration: 150,
      hideAnimationDuration: 150,
      zoomAnimationDuration: reducedMotion.value === 'reduce' ? 0 : 200,
      returnFocus: false,
      trapFocus: true,
      closeTitle: t('results.closePlot'),
      zoomTitle: t('results.zoomPlot'),
      arrowPrevTitle: t('results.previousPlot'),
      arrowNextTitle: t('results.nextPlot'),
      errorMsg: t('results.imageFailed'),
      paddingFn: (viewport) => ({
        top: 64,
        bottom: viewport.x < 640 ? 112 : 88,
        left: 16,
        right: 16,
      }),
      preload: [1, 1],
    });

    viewer = instance;
    instance.on('uiRegister', () => {
      instance.ui?.registerElement({
        name: 'artifact-caption',
        appendTo: 'root',
        onInit: (element) => {
          const title = document.createElement('h2');
          const path = document.createElement('p');
          title.id = captionTitleId;
          path.id = captionPathId;
          element.setAttribute('aria-live', 'polite');
          element.append(title, path);

          const update = () => {
            const artifact = originals[instance.currIndex];
            title.textContent = artifact ? pathName(artifact.path) : '';
            path.textContent = artifact?.path ?? '';
          };

          instance.on('change', update);
          update();
        },
      });
      instance.ui?.registerElement({
        name: 'artifact-download',
        order: 9,
        isButton: true,
        title: t('results.download'),
        html: '<svg aria-hidden="true" class="pswp__icn" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M16 7v13m-5-5 5 5 5-5M8 21v4h16v-4"/></svg>',
        onClick: () => {
          const artifact = originals[instance.currIndex];

          if (artifact) emit('download', artifact);
        },
      });
    });
    instance.on('change', () => {
      currentIndex.value = instance.currIndex;
      const artifact = originals[instance.currIndex];

      if (artifact) void props.images.request(artifact, { priority: true });
    });
    instance.on('contentLoad', ({ content }) => {
      const artifact = originals[content.index];

      if (artifact)
        void props.images.request(artifact, { priority: content.index === instance.currIndex });
    });
    instance.on('destroy', () => {
      if (viewer === instance) {
        viewer = null;
        target.value = null;
        emit('close');
      }

      if (restoreTarget?.isConnected) restoreTarget.focus({ preventScroll: true });
    });
    instance.init();
    instance.element?.setAttribute('aria-modal', 'true');
    instance.element?.setAttribute('aria-labelledby', captionTitleId);
    instance.element?.setAttribute('aria-describedby', captionPathId);
    target.value = instance.element ?? null;
  } catch {
    if (scope === generation) failed.value = true;
  }
}

function retry() {
  const artifact = currentArtifact.value;

  if (artifact) void props.images.request(artifact, { priority: true, retry: true });
}

watch(
  () => props.selected,
  () => {
    if (props.selected) void open();
    else destroy();
  },
  { immediate: true, flush: 'post' },
);

watch(plots, (current, previous) => {
  if (
    viewer &&
    (current.length !== previous.length ||
      current.some((artifact, index) => artifact !== previous[index]))
  )
    close();
});

watch(
  () => plots.value.map((artifact) => props.images.state(artifact)),
  (states, previous) => {
    const instance = viewer;

    if (!instance) return;

    if (
      states.some((state, index) => state.status === 'idle' && previous[index]?.status !== 'idle')
    ) {
      close();

      return;
    }

    const source = instance.options.dataSource;

    if (!Array.isArray(source)) return;
    states.forEach((state, index) => {
      const artifact = plots.value[index];

      if (artifact && state.status === 'ready' && state.url !== previous[index]?.url) {
        source[index] = slideData(artifact);
        instance.refreshSlideContent(index);
      }
    });
  },
);

watch(
  isActive,
  (active) => {
    if (!active && props.selected) close();
  },
  { flush: 'sync' },
);

onBeforeUnmount(destroy);
</script>

<template>
  <Teleport v-if="target" :to="target">
    <div
      v-if="currentImage?.status !== 'ready'"
      class="artifact-lightbox-status pointer-events-none absolute inset-16 flex items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <div
        class="flex max-w-sm flex-col items-center gap-3 rounded-xl border bg-card p-6 text-center text-card-foreground shadow-lg"
      >
        <template v-if="currentImage?.status === 'error'">
          <CircleAlert class="size-6 text-muted-foreground" aria-hidden="true" />
          <p class="text-sm">{{ t('results.imageFailed') }}</p>
          <Button type="button" variant="outline" class="pointer-events-auto" @click.stop="retry">
            <RotateCcw class="size-4" aria-hidden="true" />
            {{ t('results.retryImage') }}
          </Button>
        </template>
        <template v-else>
          <LoaderCircle
            class="size-6 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-hidden="true"
          />
          <p class="text-sm text-muted-foreground">{{ t('results.imageLoading') }}</p>
        </template>
      </div>
    </div>
  </Teleport>
  <Dialog :open="failed && Boolean(selected)" @update:open="close">
    <DialogContent class="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>{{ t('results.imageFailed') }}</DialogTitle>
        <DialogDescription>{{ selected?.path }}</DialogDescription>
      </DialogHeader>
      <Button type="button" variant="outline" @click="open">{{ t('results.retryImage') }}</Button>
    </DialogContent>
  </Dialog>
</template>

<style>
.artifact-lightbox {
  --pswp-bg: var(--background);
  --pswp-placeholder-bg: var(--muted);
  --pswp-icon-color: var(--foreground);
  --pswp-icon-color-secondary: var(--background);
  --pswp-icon-stroke-color: var(--background);
  --pswp-icon-stroke-width: 1px;
  --pswp-error-text-color: var(--destructive);
  --pswp-preloader-color: var(--muted);
  --pswp-preloader-color-secondary: var(--foreground);
  --pswp-root-z-index: 100;
  color: var(--foreground);
}
.artifact-lightbox .pswp__top-bar {
  background: color-mix(in oklab, var(--background) 90%, transparent);
}
.artifact-lightbox .pswp__button--artifact-download .pswp__icn {
  fill: none;
  color: var(--foreground);
}
.artifact-lightbox .pswp__counter {
  color: var(--muted-foreground);
  text-shadow: none;
}
.artifact-lightbox .pswp__button:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -4px;
  border-radius: var(--radius);
}
.artifact-lightbox .pswp__artifact-caption {
  position: absolute;
  inset: auto 0 0;
  padding: 16px max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom));
  background: color-mix(in oklab, var(--background) 94%, transparent);
  text-align: center;
  overflow-wrap: anywhere;
  pointer-events: none;
}
.artifact-lightbox .pswp__artifact-caption h2 {
  font-size: 14px;
  font-weight: 600;
}
.artifact-lightbox .pswp__artifact-caption p {
  margin-top: 4px;
  max-height: 3em;
  overflow: hidden;
  color: var(--muted-foreground);
  font-size: 12px;
}
.artifact-lightbox-status {
  z-index: 1;
}
@media (prefers-reduced-motion: reduce) {
  .artifact-lightbox *,
  .artifact-lightbox *::before,
  .artifact-lightbox *::after {
    animation-duration: 0s !important;
    transition-duration: 0s !important;
  }
}
</style>
