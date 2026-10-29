<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed, useTemplateRef } from 'vue';
import { LayoutGroup, motion } from 'motion-v';
import { ChevronLeft, ChevronRight, RotateCw, Search, SearchX } from '@lucide/vue';
import type { RunView } from '../../lib/daemon-api';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import RunStateChip from './RunStateChip.vue';
import InfoChip from '../common/InfoChip.vue';
import SegmentedControl from '../project/SegmentedControl.vue';
import {
  groupRuns,
  runCounts,
  runFilterOf,
  runMatches,
  type RunFilter,
  type RunGroupKey,
} from '../../lib/run-overview';
import { useRunLabels } from '../../composables/useRunLabels';
const { t, locale } = useI18n({ useScope: 'global' });
const labels = useRunLabels();
const props = defineProps<{
  runs: readonly RunView[];
  loading: boolean;
  page: number;
  staleRunIds?: ReadonlySet<string>;
  lastRefreshed?: string | null;
  selectedRunId?: string | null;
  now?: Date;
}>();
defineEmits<{ select: [runId: string]; refresh: []; page: [offset: number] }>();
const query = defineModel<string>('query', { default: '' });
const filter = defineModel<RunFilter>('filter', { default: 'all' });
const list = useTemplateRef<HTMLElement>('list');
const updatedLabel = computed(() => {
  const date = new Date(props.lastRefreshed ?? '');
  return Number.isNaN(date.getTime())
    ? t('runs.unavailable')
    : t('runs.updatedTime', {
        time: new Intl.DateTimeFormat(locale.value === 'vi' ? 'vi-VN' : 'en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(date),
      });
});
const counts = computed(() => runCounts(props.runs));
const filterOptions = computed(() =>
  (
    [
      ['all', t('runs.filterAll')],
      ['live', t('runs.filterLive')],
      ['completed', t('runs.filterDone')],
      ['attention', t('runs.filterAttention')],
    ] as const
  ).map(([value, label]) => ({
    value,
    label: counts.value[value] ? `${label} ${counts.value[value]}` : label,
  })),
);
const groupLabels = computed<Record<RunGroupKey, string>>(() => ({
  live: t('runs.groupLive'),
  today: t('runs.groupToday'),
  yesterday: t('runs.groupYesterday'),
  week: t('runs.groupWeek'),
  earlier: t('runs.groupEarlier'),
}));
const visible = computed(() =>
  props.runs.filter(
    (run) =>
      (filter.value === 'all' || runFilterOf(run) === filter.value) &&
      runMatches(run, query.value, [labels.operation(run)]),
  ),
);
const clock = computed(() => props.now ?? new Date());
const groups = computed(() => groupRuns(visible.value, clock.value));
const filtered = computed(() => filter.value !== 'all' || query.value.trim() !== '');
function clearFilters() {
  query.value = '';
  filter.value = 'all';
}
/** Arrow keys move between rows like a sidebar; Enter and Space stay native. */
function move(event: KeyboardEvent, step: number) {
  const rows = Array.from(list.value?.querySelectorAll<HTMLButtonElement>('button.run-row') ?? []);
  const index = rows.findIndex((row) => row === event.currentTarget);
  const next = rows[Math.min(rows.length - 1, Math.max(0, index + step))];
  if (!next) return;
  event.preventDefault();
  next.focus();
}
function enterList(event: KeyboardEvent) {
  const first = list.value?.querySelector<HTMLButtonElement>('button.run-row');
  if (!first) return;
  event.preventDefault();
  first.focus();
}
</script>
<template>
  <section class="run-list" :aria-label="t('runs.runs')">
    <header class="run-list-header">
      <h2 class="run-list-title">
        {{ t('runs.runs') }}<span v-if="runs.length" class="run-list-count">{{ runs.length }}</span>
      </h2>
      <Button
        variant="ghost"
        size="icon"
        class="run-list-refresh"
        :disabled="loading"
        :aria-label="t('runs.refresh')"
        :title="t('runs.refresh')"
        @click="$emit('refresh')"
        ><RotateCw :class="{ 'animate-spin motion-reduce:animate-none': loading }" aria-hidden="true"
      /></Button>
    </header>
    <label class="run-search">
      <Search class="run-search-icon" aria-hidden="true" />
      <span class="sr-only">{{ t('runs.searchRuns') }}</span>
      <input
        v-model="query"
        type="search"
        class="run-search-input"
        :placeholder="t('runs.searchPlaceholder')"
        :aria-describedby="runs.length ? 'run-list-keys' : undefined"
        @keydown.down="enterList"
      />
    </label>
    <div class="run-filter">
      <SegmentedControl v-model="filter" :options="filterOptions" :label="t('runs.filterRuns')" />
    </div>
    <p id="run-list-keys" class="sr-only">{{ t('runs.keyboardHint') }}</p>
    <p v-if="loading && !runs.length" role="status" class="run-list-note">
      {{ t('runs.loadingRuns') }}
    </p>
    <Empty v-else-if="!runs.length" role="status" class="run-list-empty"
      ><EmptyDescription>{{ t('runs.noRuns') }}</EmptyDescription></Empty
    >
    <div v-else-if="!visible.length" role="status" class="run-list-none">
      <SearchX aria-hidden="true" />
      <p>{{ t('runs.noMatches') }}</p>
      <Button v-if="filtered" variant="link" size="sm" @click="clearFilters">{{
        t('runs.clearFilters')
      }}</Button>
    </div>
    <div ref="list" class="run-list-scroll">
      <LayoutGroup>
        <section
          v-for="group in groups"
          :key="group.key"
          class="run-group"
          :aria-labelledby="`run-group-${group.key}`"
        >
          <h3 :id="`run-group-${group.key}`" class="run-group-title">
            {{ groupLabels[group.key] }}
          </h3>
          <ul class="items">
            <li
              v-for="run in group.runs"
              :key="run.run_id"
              class="run-item"
              :data-selected="run.run_id === selectedRunId ? 'true' : undefined"
            >
              <motion.span
                v-if="run.run_id === selectedRunId"
                layout-id="run-list-selection"
                class="run-selection"
                :transition="{ type: 'spring', stiffness: 520, damping: 40 }"
                aria-hidden="true"
              />
              <button
                type="button"
                class="run-row"
                :aria-current="run.run_id === selectedRunId ? 'true' : undefined"
                @click="$emit('select', run.run_id)"
                @keydown.down="move($event, 1)"
                @keydown.up="move($event, -1)"
              >
                <span class="run-glyph" :data-state="run.state" aria-hidden="true" />
                <span class="identity"
                  ><strong>{{ labels.title(run) }}</strong
                  ><span class="run-meta">{{ labels.meta(run, clock) }}</span
                  ><small>{{ run.run_id }}</small></span
                >
              </button>
              <span class="run-item-state"
                ><RunStateChip :run="run" :stale="staleRunIds?.has(run.run_id)"
              /></span>
            </li>
          </ul>
        </section>
      </LayoutGroup>
    </div>
    <footer class="run-list-footer">
      <InfoChip
        v-if="lastRefreshed"
        :label="updatedLabel"
        :text="t('runs.listSnapshot', { time: lastRefreshed })"
      />
      <div v-if="page > 0 || runs.length >= 50" class="run-pager" data-testid="run-pagination">
        <Button
          variant="ghost"
          size="icon"
          :disabled="loading || page === 0"
          :aria-label="t('runs.previous')"
          :title="t('runs.previous')"
          @click="$emit('page', Math.max(0, page - 50))"
          ><ChevronLeft aria-hidden="true" /></Button
        ><span>{{ t('runs.page', { page: Math.floor(page / 50) + 1 }) }}</span
        ><Button
          variant="ghost"
          size="icon"
          :disabled="loading || runs.length < 50"
          :aria-label="t('runs.next')"
          :title="t('runs.next')"
          @click="$emit('page', page + 50)"
          ><ChevronRight aria-hidden="true"
        /></Button>
      </div>
    </footer>
  </section>
</template>
<style scoped>
.run-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
  max-width: 100%;
  padding: 1rem 0.75rem 0.75rem;
  border-radius: 1.25rem;
  background: var(--surface);
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--foreground) 12%, transparent),
    0 1px 2px rgb(0 0 0 / 0.04),
    0 18px 40px -28px rgb(0 0 0 / 0.35);
}
.run-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding-inline: 0.35rem;
}
.run-list-title {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 1.15rem;
  font-weight: 650;
  letter-spacing: -0.02em;
}
.run-list-count {
  color: var(--muted-foreground);
  font-size: 0.8rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.run-list-refresh {
  border-radius: 999px;
  color: var(--muted-foreground);
}
.run-search {
  position: relative;
  display: flex;
  align-items: center;
}
.run-search-icon {
  position: absolute;
  left: 0.7rem;
  width: 0.95rem;
  height: 0.95rem;
  color: var(--muted-foreground);
  pointer-events: none;
}
.run-search-input {
  width: 100%;
  height: 2.25rem;
  padding: 0 0.75rem 0 2.15rem;
  border: 0;
  border-radius: 0.7rem;
  color: var(--foreground);
  font: inherit;
  font-size: 0.875rem;
  background: color-mix(in srgb, var(--foreground) 6%, transparent);
  outline: none;
  transition: box-shadow 160ms ease;
}
.run-search-input::placeholder {
  color: var(--muted-foreground);
}
.run-search-input:focus-visible {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 45%, transparent);
}
.run-filter :deep(.segmented-control) {
  display: flex;
  width: 100%;
}
.run-filter :deep(.segmented-control-item) {
  flex: 1 1 0;
  padding-inline: 0.4rem;
  font-variant-numeric: tabular-nums;
}
.run-list-note {
  padding: 1rem 0.5rem;
  color: var(--muted-foreground);
  font-size: 0.875rem;
}
.run-list-empty {
  padding-block: 2rem;
}
.run-list-none {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  padding: 2rem 1rem;
  color: var(--muted-foreground);
  font-size: 0.85rem;
  text-align: center;
}
.run-list-none svg {
  width: 1.5rem;
  height: 1.5rem;
  margin-bottom: 0.25rem;
}
.run-list-scroll {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 0;
  margin-inline: -0.25rem;
  padding-inline: 0.25rem;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.run-group-title {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 0.35rem 0.5rem 0.3rem;
  color: var(--muted-foreground);
  font-size: 0.68rem;
  font-weight: 650;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  background: var(--surface);
}
.items {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: 0;
}
/* Title and state share the first line; meta and ID use the full width below. */
.run-item {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-rows: auto auto auto;
  align-items: center;
  gap: 0.12rem 0.6rem;
  min-width: 0;
  padding: 0.6rem 0.65rem;
  border-radius: 0.8rem;
  transition: background-color 140ms ease;
}
.run-item:hover {
  background: color-mix(in srgb, var(--foreground) 4.5%, transparent);
}
.run-item[data-selected='true']:hover {
  background: transparent;
}
.run-selection {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: color-mix(in srgb, var(--primary) 11%, var(--surface));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary) 22%, transparent);
}
.run-row {
  position: static;
  display: grid;
  grid-column: 1 / -1;
  grid-row: 1 / -1;
  grid-template-columns: subgrid;
  grid-template-rows: subgrid;
  align-items: center;
  min-width: 0;
  padding: 0;
  border: 0;
  color: inherit;
  text-align: left;
  background: none;
  cursor: pointer;
}
/* The whole row selects; the state chip above it keeps its own tooltip control. */
.run-row::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 0.8rem;
}
.run-row:focus-visible {
  outline: none;
}
.run-row:focus-visible::after {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}
.run-item-state {
  position: relative;
  z-index: 1;
  grid-column: 3;
  grid-row: 1;
  transform-origin: right center;
  scale: 0.9;
}
.run-item-state :deep(.run-state-chip) {
  white-space: nowrap;
  flex-wrap: nowrap;
}
.run-glyph {
  position: relative;
  grid-column: 1;
  grid-row: 1;
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--foreground) 22%, transparent);
}
.run-glyph[data-state='running'],
.run-glyph[data-state='submitted'],
.run-glyph[data-state='queued'],
.run-glyph[data-state='pending'] {
  background: var(--primary);
}
.run-glyph[data-state='running']::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: inherit;
  border: 2px solid var(--primary);
  animation: run-glyph-pulse 1.8s cubic-bezier(0.22, 1, 0.36, 1) infinite;
}
.run-glyph[data-state='completed'] {
  background: var(--success);
}
.run-glyph[data-state='failed'] {
  background: var(--color-destructive);
}
.run-glyph[data-state='held'],
.run-glyph[data-state='stopping'],
.run-glyph[data-state='submission_unknown'],
.run-glyph[data-state='terminal_unknown'],
.run-glyph[data-state='supervision_lost'] {
  background: var(--warning);
}
@keyframes run-glyph-pulse {
  from {
    opacity: 0.7;
    transform: scale(0.6);
  }
  to {
    opacity: 0;
    transform: scale(1.6);
  }
}
.identity {
  display: contents;
}
/* Positioned so they paint above the selection highlight, which is positioned too. */
.identity > * {
  position: relative;
}
.identity strong {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.run-meta {
  grid-column: 2 / -1;
  grid-row: 2;
  min-width: 0;
  overflow: hidden;
  color: var(--muted-foreground);
  font-size: 0.76rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.identity small {
  grid-column: 2 / -1;
  grid-row: 3;
  min-width: 0;
  overflow: hidden;
  color: color-mix(in srgb, var(--muted-foreground) 80%, transparent);
  font:
    0.68rem/1.4 ui-monospace,
    'SF Mono',
    monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.run-list-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem 0.25rem 0;
  border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
}
.run-list-footer:empty {
  display: none;
}
.run-pager {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--muted-foreground);
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}
@media (prefers-reduced-motion: reduce) {
  .run-glyph[data-state='running']::after {
    animation: none;
  }
}
</style>
