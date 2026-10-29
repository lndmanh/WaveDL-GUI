<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed } from 'vue';
import { motion } from 'motion-v';
import { Activity, CircleCheck, Layers, TriangleAlert } from '@lucide/vue';
import type { RunView } from '../../lib/daemon-api';
import { groupRuns, runCounts } from '../../lib/run-overview';
import { useRunLabels } from '../../composables/useRunLabels';
import RunStateChip from './RunStateChip.vue';

const { t } = useI18n({ useScope: 'global' });
const props = defineProps<{ runs: readonly RunView[]; loading: boolean; now: Date }>();
defineEmits<{ select: [runId: string] }>();
const labels = useRunLabels();
const counts = computed(() => runCounts(props.runs));
const tiles = computed(() => [
  { key: 'live', label: t('runs.groupLive'), value: counts.value.live, icon: Activity },
  { key: 'completed', label: t('runs.completed'), value: counts.value.completed, icon: CircleCheck },
  {
    key: 'attention',
    label: t('runs.filterAttention'),
    value: counts.value.attention,
    icon: TriangleAlert,
  },
  { key: 'all', label: t('runs.filterAll'), value: counts.value.all, icon: Layers },
]);
// Live runs lead; otherwise the newest finished ones are the likeliest next look.
const spotlight = computed(() => {
  const groups = groupRuns(props.runs, props.now);
  const live = groups.find((group) => group.key === 'live');
  return {
    title: live ? t('runs.groupLive') : t('runs.mostRecent'),
    runs: (live?.runs ?? groups.flatMap((group) => group.runs)).slice(0, 4),
  };
});
const spring = { type: 'spring', stiffness: 260, damping: 26 } as const;
</script>
<template>
  <section class="run-overview" :aria-label="t('runs.overviewTitle')">
    <motion.header
      class="run-overview-hero"
      :initial="{ opacity: 0, y: 14 }"
      :animate="{ opacity: 1, y: 0 }"
      :transition="spring"
    >
      <h2 class="run-overview-title">{{ t('runs.overviewTitle') }}</h2>
      <p class="run-overview-hint">{{ t('runs.overviewHint') }}</p>
    </motion.header>
    <dl class="run-overview-tiles">
      <motion.div
        v-for="(tile, index) in tiles"
        :key="tile.key"
        class="run-overview-tile"
        :data-tone="tile.key"
        :initial="{ opacity: 0, y: 14 }"
        :animate="{ opacity: 1, y: 0 }"
        :transition="{ ...spring, delay: 0.04 * (index + 1) }"
      >
        <dt><component :is="tile.icon" aria-hidden="true" />{{ tile.label }}</dt>
        <dd>{{ loading && !runs.length ? '–' : tile.value }}</dd>
      </motion.div>
    </dl>
    <section
      v-if="spotlight.runs.length"
      class="run-overview-spotlight"
      aria-labelledby="run-overview-spotlight"
    >
      <h3 id="run-overview-spotlight" class="run-overview-eyebrow">{{ spotlight.title }}</h3>
      <ul class="run-overview-cards">
        <motion.li
          v-for="(run, index) in spotlight.runs"
          :key="run.run_id"
          class="run-overview-card"
          :initial="{ opacity: 0, y: 14 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ ...spring, delay: 0.2 + 0.05 * index }"
        >
          <button type="button" class="run-overview-open" @click="$emit('select', run.run_id)">
            <strong>{{ labels.title(run) }}</strong>
            <span>{{ labels.meta(run, now) }}</span>
          </button>
          <span class="run-overview-state"><RunStateChip :run="run" /></span>
        </motion.li>
      </ul>
    </section>
  </section>
</template>
<style scoped>
.run-overview {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  min-width: 0;
  padding: clamp(1.25rem, 3vw, 2.5rem);
  border-radius: 1.5rem;
  background:
    radial-gradient(
      70% 60% at 50% 0%,
      color-mix(in srgb, var(--primary) 9%, transparent),
      transparent 70%
    ),
    color-mix(in srgb, var(--surface) 55%, transparent);
  box-shadow: 0 0 0 0.5px color-mix(in srgb, var(--foreground) 10%, transparent);
}
.run-overview-title {
  font-size: clamp(1.4rem, 2.6vw, 1.85rem);
  font-weight: 650;
  letter-spacing: -0.03em;
}
.run-overview-hint {
  max-width: 44ch;
  margin-top: 0.35rem;
  color: var(--muted-foreground);
}
.run-overview-tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 9.5rem), 1fr));
  gap: 0.75rem;
  margin: 0;
}
.run-overview-tile {
  --tone: var(--muted-foreground);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 1rem 1.1rem;
  border-radius: 1.1rem;
  background: var(--surface);
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--foreground) 10%, transparent),
    0 1px 2px rgb(0 0 0 / 0.04);
}
.run-overview-tile[data-tone='live'] {
  --tone: var(--primary);
}
.run-overview-tile[data-tone='completed'] {
  --tone: var(--success);
}
.run-overview-tile[data-tone='attention'] {
  --tone: var(--warning);
}
.run-overview-tile dt {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--muted-foreground);
  font-size: 0.78rem;
  font-weight: 550;
}
.run-overview-tile dt svg {
  width: 0.95rem;
  height: 0.95rem;
  color: var(--tone);
}
.run-overview-tile dd {
  margin: 0;
  font-size: 2rem;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  line-height: 1;
}
.run-overview-scope {
  margin-top: -0.5rem;
  color: var(--muted-foreground);
  font-size: 0.75rem;
}
.run-overview-eyebrow {
  margin-bottom: 0.6rem;
  color: var(--muted-foreground);
  font-size: 0.7rem;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.run-overview-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.run-overview-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
  padding: 1rem 1.1rem;
  border-radius: 1.1rem;
  background: var(--surface);
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--foreground) 10%, transparent),
    0 1px 2px rgb(0 0 0 / 0.04);
  transition:
    transform 220ms cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 220ms ease;
}
.run-overview-card:hover {
  transform: translateY(-2px);
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--foreground) 12%, transparent),
    0 14px 30px -18px rgb(0 0 0 / 0.35);
}
.run-overview-open {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
  padding: 0;
  border: 0;
  color: inherit;
  text-align: left;
  background: none;
  cursor: pointer;
}
.run-overview-open::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 1.1rem;
}
.run-overview-open:focus-visible {
  outline: none;
}
.run-overview-open:focus-visible::after {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
.run-overview-open strong {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.run-overview-open span {
  overflow: hidden;
  color: var(--muted-foreground);
  font-size: 0.78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.run-overview-state {
  position: relative;
  z-index: 1;
  align-self: flex-start;
}
@media (prefers-reduced-motion: reduce) {
  .run-overview-card,
  .run-overview-card:hover {
    transform: none;
    transition: none;
  }
}
</style>
