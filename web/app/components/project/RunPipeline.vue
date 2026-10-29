<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { nextTick, watch, type Component } from 'vue';
import { LayoutGroup, motion } from 'motion-v';
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  Cpu,
  Database,
  LoaderCircle,
  SlidersHorizontal,
  Sparkles,
} from '@lucide/vue';
import { Button } from '@/components/ui/button';
import type { ProjectBlock } from '../../../shared/schemas/project-draft';

export interface PipelineBlock {
  readonly id: ProjectBlock;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  /** complete: ready; attention: usable but worth a look; pending: needs input. */
  readonly state: 'complete' | 'attention' | 'pending';
}

const props = defineProps<{
  blocks: readonly PipelineBlock[];
  active: ProjectBlock;
  panelId: string;
  reviewLabel: string;
  reviewDisabled: boolean;
  reviewBusy: boolean;
}>();
const emit = defineEmits<{ select: [block: ProjectBlock]; review: [] }>();
const { t } = useI18n({ useScope: 'global' });

const icons: Record<ProjectBlock, Component> = {
  dataset: Database,
  model: Sparkles,
  training: SlidersHorizontal,
  runtime: Cpu,
  plan: ClipboardCheck,
};

function tabId(block: ProjectBlock): string {
  return `${props.panelId}-tab-${block}`;
}

// On narrow screens the strip scrolls sideways; keep the active block in view.
watch(
  () => props.active,
  (block) =>
    void nextTick(() =>
      document
        .getElementById(tabId(block))
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }),
    ),
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
</script>
<template>
  <div class="run-pipeline" data-testid="project-stepper">
    <LayoutGroup>
      <div
        role="tablist"
        :aria-label="t('builder.runSteps')"
        aria-orientation="horizontal"
        class="run-pipeline-track"
      >
        <template v-for="(block, index) in blocks" :key="block.id">
          <span
            v-if="index > 0"
            class="run-pipeline-link"
            :data-complete="blocks[index - 1]?.state === 'complete'"
            aria-hidden="true"
          />
          <button
            :id="tabId(block.id)"
            type="button"
            role="tab"
            class="run-pipeline-block"
            :aria-selected="active === block.id"
            :aria-controls="panelId"
            :aria-current="active === block.id ? 'step' : undefined"
            :tabindex="active === block.id ? 0 : -1"
            :data-state="block.state"
            :data-testid="`guide-step-${index}`"
            :title="`${block.value} · ${block.detail}`"
            @click="emit('select', block.id)"
            @keydown="move($event, index)"
          >
            <motion.span
              v-if="active === block.id"
              layout-id="run-pipeline-selection"
              class="run-pipeline-selection"
              :transition="{ type: 'spring', stiffness: 520, damping: 40 }"
              aria-hidden="true"
            />
            <span class="run-pipeline-icon" :data-block="block.id" aria-hidden="true">
              <component :is="icons[block.id]" />
              <motion.span
                v-if="block.state !== 'pending'"
                :key="block.state"
                class="run-pipeline-badge"
                :data-state="block.state"
                :initial="{ scale: 0.4, opacity: 0 }"
                :animate="{ scale: 1, opacity: 1 }"
                :transition="{ type: 'spring', stiffness: 600, damping: 24 }"
              >
                <Check v-if="block.state === 'complete'" />
              </motion.span>
            </span>
            <span class="run-pipeline-copy">
              <span class="run-pipeline-label">{{ block.label }}</span>
              <span class="run-pipeline-value">{{ block.value }}</span>
              <span class="sr-only">{{ block.detail }}</span>
            </span>
          </button>
        </template>
      </div>
    </LayoutGroup>
    <Button
      type="button"
      class="run-pipeline-review"
      :disabled="reviewDisabled"
      @click="emit('review')"
    >
      <LoaderCircle v-if="reviewBusy" class="animate-spin" aria-hidden="true" />
      {{ reviewLabel }}
      <ArrowRight v-if="!reviewBusy" aria-hidden="true" />
    </Button>
  </div>
</template>
<style>
.run-pipeline {
  position: sticky;
  top: 0.75rem;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem;
  border-radius: 1.25rem;
  background: color-mix(in srgb, var(--surface) 90%, transparent);
  backdrop-filter: saturate(180%) blur(24px);
  -webkit-backdrop-filter: saturate(180%) blur(24px);
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--foreground) 10%, transparent),
    0 12px 32px -18px rgb(0 0 0 / 0.35);
}
/* A page-coloured band behind the stuck strip, so scrolled headings never show around it. */
.run-pipeline::before {
  position: absolute;
  z-index: -1;
  top: -0.75rem;
  right: -1rem;
  bottom: -1rem;
  left: -1rem;
  /* The shell canvas: half card over the background. */
  --run-pipeline-canvas: color-mix(in srgb, var(--card) 50%, var(--background));
  background: linear-gradient(var(--run-pipeline-canvas) 70%, transparent);
  content: '';
  pointer-events: none;
}
.run-pipeline-track {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  /* Room for the selection ring, which overflow-x would otherwise clip. */
  padding: 3px;
  margin: -3px;
  overflow-x: auto;
  scrollbar-width: none;
  scroll-snap-type: x proximity;
}
.run-pipeline-track::-webkit-scrollbar {
  display: none;
}
.run-pipeline-block {
  position: relative;
  display: flex;
  flex: 1 1 0;
  min-width: 8.5rem;
  align-items: center;
  gap: 0.65rem;
  padding: 0.6rem 0.7rem;
  border-radius: 0.9rem;
  text-align: left;
  scroll-snap-align: start;
  transition: background-color 160ms ease;
}
.run-pipeline-block:hover:not([aria-selected='true']) {
  background: color-mix(in srgb, var(--foreground) 4%, transparent);
}
.run-pipeline-block:focus-visible {
  outline-offset: -2px;
}
.run-pipeline-selection {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--surface);
  box-shadow:
    0 0 0 1.5px var(--primary),
    0 6px 18px -8px color-mix(in srgb, var(--primary) 55%, transparent);
}
.run-pipeline-icon {
  position: relative;
  display: grid;
  flex: none;
  width: 2.1rem;
  height: 2.1rem;
  place-items: center;
  border-radius: 0.6rem;
  color: #fff;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.25);
}
.run-pipeline-icon svg {
  width: 1.05rem;
  height: 1.05rem;
}
.run-pipeline-icon[data-block='dataset'] {
  background: linear-gradient(160deg, #35c46a, #1f9d55);
}
.run-pipeline-icon[data-block='model'] {
  background: linear-gradient(160deg, #4b9dff, #0a63d8);
}
.run-pipeline-icon[data-block='training'] {
  background: linear-gradient(160deg, #ffad3b, #f07b16);
}
.run-pipeline-icon[data-block='runtime'] {
  background: linear-gradient(160deg, #9d8cf6, #6b55e0);
}
.run-pipeline-icon[data-block='plan'] {
  background: linear-gradient(160deg, #5f6672, #3a3f48);
}
.run-pipeline-badge {
  position: absolute;
  right: -0.3rem;
  bottom: -0.3rem;
  display: grid;
  width: 1rem;
  height: 1rem;
  place-items: center;
  border-radius: 999px;
  border: 2px solid var(--surface);
  background: var(--success);
}
.run-pipeline-badge[data-state='attention'] {
  background: var(--warning);
}
.run-pipeline-badge svg {
  width: 0.6rem;
  height: 0.6rem;
  stroke-width: 3.5;
}
.run-pipeline-copy {
  position: relative;
  display: flex;
  min-width: 0;
  flex-direction: column;
  line-height: 1.25;
}
.run-pipeline-label {
  color: var(--muted-foreground);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.run-pipeline-block[aria-selected='true'] .run-pipeline-label {
  color: var(--primary);
}
.run-pipeline-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.run-pipeline-value {
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.run-pipeline-block[data-state='pending'] .run-pipeline-value {
  color: var(--muted-foreground);
  font-weight: 500;
}
.run-pipeline-link {
  position: relative;
  flex: 0 0 0.75rem;
  height: 2px;
  border-radius: 1px;
  background: var(--border);
  overflow: hidden;
}
.run-pipeline-link::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--success);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
}
.run-pipeline-link[data-complete='true']::after {
  transform: scaleX(1);
}
.run-pipeline-review {
  flex: none;
  height: 2.75rem;
  border-radius: 0.9rem;
  padding-inline: 1.1rem;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.2),
    0 6px 16px -6px color-mix(in srgb, var(--primary) 70%, transparent);
}
@media (max-width: 52rem) {
  .run-pipeline {
    flex-direction: column;
    align-items: stretch;
  }
  .run-pipeline-block {
    min-width: 8.5rem;
  }
}
</style>
