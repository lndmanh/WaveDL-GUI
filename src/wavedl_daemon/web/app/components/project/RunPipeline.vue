<script setup lang="ts">
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'motion-v';
import {
  Check,
  CircleAlert,
  ClipboardCheck,
  Cpu,
  Database,
  SlidersHorizontal,
  Sparkles,
} from '@lucide/vue';
import type { ProjectBlock } from '../../../shared/schemas/project-draft';
import { EASE_OUT_EXPO } from '@/lib/animation';
import type { PipelineBlock } from '~~/types/project-draft';

const props = defineProps<{
  blocks: readonly PipelineBlock[];
  active: ProjectBlock;
  panelId: string;
}>();

defineOptions({ inheritAttrs: false });

const emit = defineEmits<{
  select: [block: ProjectBlock];
  measure: [bottom: number];
}>();

const { t } = useI18n({ useScope: 'global' });
const reduceMotion = useReducedMotion();
const root = useTemplateRef<HTMLElement>('root');
const card = useTemplateRef<HTMLElement>('card');

const icons: Record<ProjectBlock, Component> = {
  dataset: Database,
  model: Sparkles,
  training: SlidersHorizontal,
  runtime: Cpu,
  plan: ClipboardCheck,
};

const stateLabels: Record<PipelineBlock['state'], string> = {
  complete: 'builder.stepReady',
  attention: 'builder.stepCheck',
  pending: 'builder.stepToDo',
};

function tabId(block: ProjectBlock): string {
  return `${props.panelId}-tab-${block}`;
}

/**
 * Once the strip sticks to the top of its scroller it condenses to icon and value.
 * The scroller is whichever ancestor scrolls, so listen at the document and keep only those.
 */
const condensed = shallowRef(false);

function updateCondensed(event: Event) {
  const strip = root.value;
  const target = event.target;

  if (!strip) return;

  const scroller =
    target instanceof Element && target.contains(strip)
      ? { top: target.getBoundingClientRect().top, offset: target.scrollTop }
      : target === document
        ? { top: 0, offset: window.scrollY }
        : null;

  if (!scroller) return;
  const stickyTop = Number.parseFloat(getComputedStyle(strip).top) || 0;

  condensed.value =
    scroller.offset > 0 && strip.getBoundingClientRect().top - scroller.top <= stickyTop + 1;
}

useEventListener(document, 'scroll', updateCondensed, { capture: true, passive: true });

/** The strip keeps its expanded height in the flow while condensed, so content below never jumps. */
const expandedHeight = shallowRef<number | null>(null);

useResizeObserver(card, () => {
  const strip = root.value;
  const surface = card.value;

  if (!strip || !surface) return;

  if (!condensed.value) expandedHeight.value = surface.offsetHeight;

  // Share the visible card edge, not the expanded space reserved by the sticky wrapper.
  const stickyTop = Number.parseFloat(getComputedStyle(strip).top) || 0;
  emit('measure', stickyTop + surface.getBoundingClientRect().height);
});

const reservedSpace = computed(() =>
  condensed.value && expandedHeight.value ? { height: `${expandedHeight.value}px` } : undefined,
);

const valueTransition = computed(() =>
  reduceMotion.value ? { duration: 0 } : { duration: 0.24, ease: EASE_OUT_EXPO },
);

/** Roving focus per the WAI-ARIA tabs pattern; selection follows focus. */
function move(event: KeyboardEvent, index: number) {
  const last = props.blocks.length - 1;

  const target =
    event.key === 'ArrowRight'
      ? index === last
        ? 0
        : index + 1
      : event.key === 'ArrowLeft'
        ? index === 0
          ? last
          : index - 1
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? last
            : null;

  const block = target === null ? undefined : props.blocks[target];

  if (target === null || !block) return;
  event.preventDefault();
  emit('select', block.id);
  void nextTick(() => document.getElementById(tabId(block.id))?.focus());
}

const condensedEase = 'cubic-bezier(0.2,_0.8,_0.2,_1)';

const projectStyles = {
  runPipeline: cn('@container/pipeline sticky top-3 z-20 pointer-events-none'),
  runPipelineCard: cn(
    'pointer-events-auto relative flex items-stretch gap-2 p-1.5 rounded-[1.35rem]',
    '[transition:background-color_240ms_ease,_box-shadow_240ms_ease]',
    "[&[data-condensed='true']]:[background:color-mix(in_srgb,_var(--surface)_88%,_transparent)]",
    "[&[data-condensed='true']]:[backdrop-filter:saturate(180%)_blur(20px)]",
    "[&[data-condensed='true']]:[-webkit-backdrop-filter:saturate(180%)_blur(20px)]",
    "[&[data-condensed='true']]:shadow-[0_0_0_0.5px_color-mix(in_srgb,_var(--foreground)_10%,_transparent),_0_12px_32px_-18px_rgb(0_0_0_/_0.35)]",
    // Covers content scrolling through the gap above the stuck strip.
    "[&::before]:absolute [&::before]:-z-1 [&::before]:top-[-0.75rem] [&::before]:right-[-1rem] [&::before]:[content:'']",
    '[&::before]:bottom-[-1rem] [&::before]:left-[-1rem] [&::before]:pointer-events-none [&::before]:opacity-0',
    '[&::before]:[--run-pipeline-canvas:color-mix(in_srgb,_var(--card)_50%,_var(--background))]',
    '[&::before]:[background:linear-gradient(var(--run-pipeline-canvas)_70%,_transparent)]',
    "[&::before]:[transition:opacity_240ms_ease] [&[data-condensed='true']::before]:opacity-100",
    '@max-[34rem]/pipeline:flex-col',
  ),
  runPipelineGrid: cn(
    'grid min-w-0 flex-1 grid-cols-5 gap-x-3 gap-y-2',
    '@max-[50rem]/pipeline:grid-cols-3 @max-[34rem]/pipeline:grid-cols-2',
  ),
  runPipelineTile: cn(
    'relative flex min-w-0 flex-col gap-2.5 p-3 rounded-[0.95rem] text-left',
    '[background:color-mix(in_srgb,_var(--foreground)_3.5%,_transparent)]',
    `[transition:background-color_200ms_ease,_box-shadow_200ms_ease,_padding_320ms_${condensedEase},_gap_320ms_${condensedEase}]`,
    "[&:hover:not([aria-selected='true'])]:[background:color-mix(in_srgb,_var(--foreground)_6%,_transparent)]",
    "[&[aria-selected='true']]:[background:color-mix(in_srgb,_var(--primary)_11%,_var(--surface))]",
    "[&[aria-selected='true']]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,_var(--primary)_55%,_transparent),_0_10px_24px_-16px_color-mix(in_srgb,_var(--primary)_70%,_transparent)]",
    '[&:focus-visible]:[outline-offset:2px]',
    // A short link in the gap before each step; it turns green once the step before is ready.
    "[&:not(:first-child)::before]:[content:''] [&::before]:absolute [&::before]:top-1/2 [&::before]:left-[-0.625rem]",
    '[&::before]:h-0.5 [&::before]:w-2 [&::before]:-translate-y-1/2 [&::before]:rounded-full [&::before]:bg-border',
    "[&::before]:[transition:background-color_300ms_ease] [&[data-linked='true']::before]:bg-success",
    '@max-[50rem]/pipeline:[&::before]:hidden',
    "[[data-condensed='true']_&]:gap-1.5 [[data-condensed='true']_&]:py-2 [[data-condensed='true']_&]:px-2.5",
    "[&[aria-selected='true']_.run-pipeline-label]:text-primary",
    "[&[data-state='pending']_.run-pipeline-value]:text-muted-foreground",
    "[&[data-state='pending']_.run-pipeline-value]:font-medium",
    // Steps that still need input recede until they are picked or hovered.
    "[&[data-state='pending']:not([aria-selected='true']):not(:hover)_.run-pipeline-icon]:[filter:saturate(0.15)]",
    "[&[data-state='pending']:not([aria-selected='true']):not(:hover)_.run-pipeline-icon]:opacity-55",
    '[&:active_.run-pipeline-icon]:scale-[0.92]',
  ),
  runPipelineTop: cn('flex items-center justify-between gap-2'),
  runPipelineIcon: cn(
    'grid flex-none size-[1.9rem] place-items-center rounded-[0.6rem] text-white',
    'shadow-[inset_0_1px_0_rgb(255_255_255_/_0.25)] [&_svg]:size-[0.95rem]',
    `[transition:transform_160ms_${condensedEase},_filter_240ms_ease,_opacity_240ms_ease,_width_320ms_${condensedEase},_height_320ms_${condensedEase}]`,
    "[[data-condensed='true']_&]:size-[1.6rem]",
    "[&[data-block='dataset']]:[background:linear-gradient(160deg,_#35c46a,_#1f9d55)]",
    "[&[data-block='model']]:[background:linear-gradient(160deg,_#4b9dff,_#0a63d8)]",
    "[&[data-block='training']]:[background:linear-gradient(160deg,_#ffad3b,_#f07b16)]",
    "[&[data-block='runtime']]:[background:linear-gradient(160deg,_#9d8cf6,_#6b55e0)]",
    "[&[data-block='plan']]:[background:linear-gradient(160deg,_#5f6672,_#3a3f48)]",
  ),
  runPipelinePill: cn(
    'inline-flex h-5 items-center gap-1 px-[0.45rem] rounded-full whitespace-nowrap',
    'text-[0.68rem] font-bold text-muted-foreground [&_svg]:size-2.5 [&_svg]:stroke-[3.5]',
    '[background:color-mix(in_srgb,_var(--foreground)_7%,_transparent)]',
    '[transition:background-color_240ms_ease,_color_240ms_ease]',
    "[&[data-state='complete']]:text-success [&[data-state='attention']]:text-warning",
    "[&[data-state='complete']]:[background:color-mix(in_srgb,_var(--success)_15%,_transparent)]",
    "[&[data-state='attention']]:[background:color-mix(in_srgb,_var(--warning)_15%,_transparent)]",
  ),
  /** Parts that fold away once the strip condenses. */
  runPipelineFold: cn(
    'grid grid-rows-[1fr] [&>*]:min-h-0 [&>*]:overflow-hidden',
    `[transition:grid-template-rows_320ms_${condensedEase},_opacity_220ms_ease]`,
    "[[data-condensed='true']_&]:grid-rows-[0fr] [[data-condensed='true']_&]:opacity-0",
  ),
  runPipelineCopy: cn('flex min-w-0 flex-col leading-[1.3]'),
  runPipelineLabel: cn(
    'block text-[0.74rem] font-semibold text-muted-foreground [transition:color_180ms_ease]',
  ),
  runPipelineValue: cn(
    'block overflow-hidden text-ellipsis whitespace-nowrap text-[0.95rem] font-bold tracking-[-0.01em]',
  ),
  runPipelineDetail: cn(
    'block overflow-hidden text-ellipsis whitespace-nowrap text-[0.74rem] text-muted-foreground',
  ),
};
</script>
<template>
  <div
    ref="root"
    v-bind="$attrs"
    :class="projectStyles.runPipeline"
    :style="reservedSpace"
    data-testid="project-stepper"
  >
    <div ref="card" :class="projectStyles.runPipelineCard" :data-condensed="condensed">
      <div
        role="tablist"
        :aria-label="t('builder.runSteps')"
        aria-orientation="horizontal"
        :class="projectStyles.runPipelineGrid"
      >
        <button
          v-for="(block, index) in blocks"
          :id="tabId(block.id)"
          :key="block.id"
          type="button"
          role="tab"
          :class="projectStyles.runPipelineTile"
          :aria-selected="active === block.id"
          :aria-controls="panelId"
          :aria-current="active === block.id ? 'step' : undefined"
          :tabindex="active === block.id ? 0 : -1"
          :data-state="block.state"
          :data-linked="blocks[index - 1]?.state === 'complete'"
          :data-testid="`guide-step-${index}`"
          :title="`${block.value} · ${block.detail}`"
          @click="emit('select', block.id)"
          @keydown="move($event, index)"
        >
          <span :class="projectStyles.runPipelineTop">
            <span
              :class="cn('run-pipeline-icon', projectStyles.runPipelineIcon)"
              :data-block="block.id"
              aria-hidden="true"
            >
              <component :is="icons[block.id]" />
            </span>
            <span :class="projectStyles.runPipelineFold">
              <span>
                <span :class="projectStyles.runPipelinePill" :data-state="block.state">
                  <Check v-if="block.state === 'complete'" aria-hidden="true" />
                  <CircleAlert v-else-if="block.state === 'attention'" aria-hidden="true" />
                  {{ t(stateLabels[block.state]) }}
                </span>
              </span>
            </span>
          </span>
          <span :class="projectStyles.runPipelineCopy">
            <span :class="projectStyles.runPipelineFold">
              <span :class="cn('run-pipeline-label', projectStyles.runPipelineLabel)">{{
                block.label
              }}</span>
            </span>
            <span class="relative block min-w-0">
              <AnimatePresence :initial="false" mode="popLayout">
                <motion.span
                  :key="block.value"
                  :class="cn('run-pipeline-value', projectStyles.runPipelineValue)"
                  :initial="{ opacity: 0, y: 6 }"
                  :animate="{ opacity: 1, y: 0 }"
                  :exit="{ opacity: 0, y: -6 }"
                  :transition="valueTransition"
                  >{{ block.value }}</motion.span
                >
              </AnimatePresence>
            </span>
            <span :class="projectStyles.runPipelineFold">
              <span :class="projectStyles.runPipelineDetail">{{ block.detail }}</span>
            </span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
