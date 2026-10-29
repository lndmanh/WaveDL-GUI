<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { motion } from 'motion-v';
import { CornerDownLeft, FileUp, Plus } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { usePageActive } from '../../composables/usePageActive';

export interface DraftSummary {
  readonly savedAt: number;
  readonly steps: readonly { readonly label: string; readonly value: string; readonly done: boolean }[];
  readonly changes: readonly string[];
}

const props = defineProps<{ summary: DraftSummary; dragging: boolean }>();
const emit = defineEmits<{ continue: []; import: []; fresh: [] }>();
const { t, locale } = useI18n({ useScope: 'global' });
const continueButton = useTemplateRef<InstanceType<typeof Button>>('continueButton');
const now = shallowRef(Date.now());

const edited = computed(() => {
  const minutes = Math.round((props.summary.savedAt - now.value) / 60000);
  const format = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute');
  if (Math.abs(minutes) < 60 * 24) return format.format(Math.round(minutes / 60), 'hour');
  return format.format(Math.round(minutes / 1440), 'day');
});
const spring = { type: 'spring', stiffness: 260, damping: 26 } as const;

function keydown(event: KeyboardEvent) {
  const target = event.target;
  if (
    event.key !== 'Enter' ||
    event.defaultPrevented ||
    (target instanceof HTMLElement && target.closest('input, textarea, select, button, a'))
  )
    return;
  event.preventDefault();
  emit('continue');
}
function attach() {
  window.addEventListener('keydown', keydown);
  const element = continueButton.value?.$el;
  if (element instanceof HTMLElement) element.focus({ preventScroll: true });
}
function detach() {
  window.removeEventListener('keydown', keydown);
}
usePageActive(attach, detach);
</script>
<template>
  <section class="start-stage" :aria-label="t('builder.startTitle')">
    <div class="start-grid">
      <motion.article
        class="start-hero"
        :initial="{ opacity: 0, y: 18, scale: 0.98 }"
        :animate="{ opacity: 1, y: 0, scale: 1 }"
        :transition="spring"
      >
        <p class="start-eyebrow">{{ t('builder.draft') }}</p>
        <h2 class="mt-1.5 text-[1.6rem] font-semibold tracking-[-0.025em]">
          {{ t('builder.startTitle') }}
        </h2>
        <p class="mt-0.5 text-sm text-muted-foreground">{{ t('builder.editedAgo', { time: edited }) }}</p>

        <ol class="start-chain">
          <template v-for="(step, index) in summary.steps" :key="step.label">
            <li v-if="index > 0" class="start-wire" aria-hidden="true" />
            <li class="min-w-0 flex-1">
              <span class="start-step-label"><i :data-done="step.done" aria-hidden="true" />{{ step.label }}</span>
              <span class="start-step-value">{{ step.value }}</span>
            </li>
          </template>
        </ol>

        <div v-if="summary.changes.length" class="flex flex-wrap items-center gap-1.5">
          <span v-for="change in summary.changes" :key="change" class="start-chip">{{ change }}</span>
          <span class="ml-0.5 text-xs text-muted-foreground">{{ t('builder.changedFromRecipe') }}</span>
        </div>

        <div class="mt-6 flex items-center gap-3">
          <Button
            ref="continueButton"
            type="button"
            size="lg"
            class="start-continue"
            data-testid="continue-draft"
            @click="emit('continue')"
          >
            {{ t('builder.continueDraft') }}
          </Button>
          <kbd class="start-kbd" :title="t('builder.pressReturn')"><CornerDownLeft aria-hidden="true" /></kbd>
        </div>
      </motion.article>

      <div class="flex flex-col gap-3">
        <motion.button
          type="button"
          class="start-drop"
          :data-dragging="dragging"
          :initial="{ opacity: 0, y: 18 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ ...spring, delay: 0.06 }"
          @click="emit('import')"
        >
          <span class="start-drop-icon"><FileUp aria-hidden="true" /></span>
          <span class="text-[0.95rem] font-medium">{{ t('builder.importConfig') }}</span>
          <span class="max-w-[26ch] text-xs text-muted-foreground">{{ t('builder.dropHint') }}</span>
        </motion.button>
        <motion.button
          type="button"
          class="start-fresh"
          :initial="{ opacity: 0, y: 18 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ ...spring, delay: 0.12 }"
          data-testid="start-fresh"
          @click="emit('fresh')"
        >
          <span class="start-fresh-icon"><Plus aria-hidden="true" /></span>
          <span class="flex min-w-0 flex-col text-left">
            <span class="text-[0.92rem] font-medium">{{ t('builder.startFresh') }}</span>
            <span class="text-xs text-muted-foreground">{{ t('builder.startFreshHelp') }}</span>
          </span>
        </motion.button>
      </div>
    </div>
  </section>
</template>
<style>
.start-stage {
  display: flex;
  justify-content: center;
  padding: 3rem 0 4rem;
  background: radial-gradient(
    60% 50% at 50% 0%,
    color-mix(in srgb, var(--primary) 8%, transparent),
    transparent 70%
  );
}
.start-grid {
  display: grid;
  width: 100%;
  max-width: 54rem;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 1rem;
}
@media (max-width: 44rem) {
  .start-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.start-hero {
  position: relative;
  overflow: hidden;
  padding: 1.6rem;
  border-radius: 1.4rem;
  background: var(--surface);
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--foreground) 10%, transparent),
    0 24px 48px -24px rgb(0 0 0 / 0.3),
    0 2px 6px rgb(0 0 0 / 0.04);
}
.start-hero::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 3px;
  background: linear-gradient(90deg, #0a63d8, #5aa9ff, #35c46a);
}
.start-eyebrow {
  color: var(--muted-foreground);
  font-size: 0.7rem;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.start-chain {
  display: flex;
  align-items: center;
  margin: 1.25rem 0 1rem;
  padding: 0.9rem 1rem;
  border-radius: 0.9rem;
  background: color-mix(in srgb, var(--foreground) 3.5%, transparent);
}
.start-wire {
  flex: 0 0 1rem;
  height: 2px;
  margin: 0 0.4rem;
  border-radius: 1px;
  background: color-mix(in srgb, var(--foreground) 15%, transparent);
}
.start-step-label {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--muted-foreground);
  font-size: 0.7rem;
}
.start-step-label i {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--foreground) 20%, transparent);
}
.start-step-label i[data-done='true'] {
  background: var(--success);
}
.start-step-value {
  display: block;
  overflow: hidden;
  font-size: 0.82rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.start-chip {
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  color: var(--primary);
  font-size: 0.72rem;
  font-weight: 550;
  background: color-mix(in srgb, var(--primary) 11%, transparent);
}
.start-continue {
  flex: 1;
  height: 2.9rem;
  border-radius: 0.9rem;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.22),
    0 8px 20px -8px color-mix(in srgb, var(--primary) 75%, transparent);
}
.start-kbd {
  display: grid;
  width: 2rem;
  height: 1.7rem;
  place-items: center;
  border-radius: 0.4rem;
  color: var(--muted-foreground);
  background: color-mix(in srgb, var(--foreground) 5%, transparent);
  box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--foreground) 12%, transparent);
}
.start-kbd svg {
  width: 0.85rem;
  height: 0.85rem;
}
.start-drop {
  display: flex;
  flex: 1;
  min-height: 12rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  padding: 1.25rem;
  border-radius: 1.4rem;
  border: 1.5px dashed color-mix(in srgb, var(--foreground) 18%, transparent);
  background: color-mix(in srgb, var(--surface) 55%, transparent);
  text-align: center;
  transition:
    border-color 180ms ease,
    background-color 180ms ease,
    transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.start-drop:hover,
.start-drop[data-dragging='true'] {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 6%, var(--surface));
}
.start-drop[data-dragging='true'] {
  transform: scale(1.02);
}
.start-drop-icon {
  display: grid;
  width: 2.75rem;
  height: 2.75rem;
  margin-bottom: 0.5rem;
  place-items: center;
  border-radius: 0.8rem;
  color: var(--primary);
  background: var(--surface);
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--foreground) 10%, transparent),
    0 4px 12px -4px rgb(0 0 0 / 0.15);
}
.start-fresh {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 0.9rem 1rem;
  border-radius: 1.1rem;
  background: var(--surface);
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--foreground) 10%, transparent),
    0 1px 2px rgb(0 0 0 / 0.04);
  transition: transform 200ms ease;
}
.start-fresh:hover {
  transform: translateY(-1px);
}
.start-fresh-icon {
  display: grid;
  width: 2rem;
  height: 2rem;
  flex: none;
  place-items: center;
  border-radius: 0.6rem;
  background: color-mix(in srgb, var(--foreground) 6%, transparent);
}
</style>
