<script setup lang="ts">
import { CircleAlert, GitCompareArrows } from '@lucide/vue';
import { MotionConfig } from 'motion-v';
import type { DaemonApi } from '../../../lib/daemon-api';
import { finiteMetric } from '../../../lib/evaluation-scorecard';
import { parameterRows, parseCompareQuery, rankByMetric, seriesColor } from '../../../lib/test-compare';
import type { HeadlineMetric } from '../../../lib/test-compare';
import { parentTitle } from '../../../lib/test-runs';
import { pathName } from '../../../lib/run-overview';
import { cn } from '../../../lib/utils';
const props = defineProps<{ api: DaemonApi }>();
const route = useRoute();
const router = useRouter();
const { t } = useI18n({ useScope: 'global' });
const query = computed(() => parseCompareQuery(route.query.ids, route.query.ref));
const ids = computed(() => query.value.ids);
const { entries, invalidIds, loading, refresh } = useTestComparison(props.api, ids);
const dropped = ref(0);
const sort = ref<HeadlineMetric>('r2_score');
const view = ref('cards');
const hoveredId = ref<string | null>(null);
const reference = computed(() => entries.value.find((entry) => entry.id === query.value.ref) ?? null);
const referenceName = computed(() => reference.value?.run ? `${parentTitle(reference.value.run) ?? reference.value.id} · ${pathName(reference.value.run.summary?.data_path)}` : '');
const visible = computed(() => entries.value.filter((entry) => entry.run !== null && ids.value.includes(entry.id)));
const ranked = computed(() => rankByMetric(visible.value.map((entry) => ({ id: entry.id, value: finiteMetric(entry.metrics?.[sort.value]) })), sort.value).flatMap((id) => {
  const entry = visible.value.find((item) => item.id === id);
  return entry ? [entry] : [];
}));
const cards = computed(() => [...ranked.value].sort((left, right) => Number(right.id === query.value.ref) - Number(left.id === query.value.ref)));
const parameters = computed(() => parameterRows(cards.value.map((entry) => entry.parameters)));
const styles = {
  root: cn('comparison-container flex min-w-0 flex-col gap-4 pb-4'),
  scroller: cn('compare-scroller grid auto-cols-[minmax(300px,1fr)] grid-flow-col items-stretch gap-3.5 overflow-x-auto overscroll-x-contain snap-x snap-mandatory p-0.5 pb-3'),
};
function replace(nextIds: string[], referenceId: string | null = query.value.ref) {
  const next = parseCompareQuery(nextIds.join(','), referenceId);
  void router.replace({ path: '/tests/compare', query: { ...route.query, ids: next.ids.join(','), ref: next.ref ?? undefined } });
}
watch(() => [route.query.ids, route.query.ref], () => {
  const parsed = query.value;
  if (parsed.dropped) dropped.value += parsed.dropped;
  if (route.query.ids !== parsed.ids.join(',') || route.query.ref !== (parsed.ref ?? undefined)) replace(parsed.ids, parsed.ref);
}, { immediate: true });
watch(invalidIds, (invalid) => {
  if (!invalid.length) return;
  dropped.value += invalid.length;
  replace(ids.value.filter((id) => !invalid.includes(id)));
});
function add(id: string) { if (ids.value.length < 8 && !ids.value.includes(id)) replace([...ids.value, id]); }
function jump(id: string) {
  view.value = 'cards';
  nextTick(() => document.getElementById(`compare-${id}`)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest', inline: 'center' }));
}
</script>

<template>
  <MotionConfig reduced-motion="user">
    <Tabs v-model="view" as="section" :class="styles.root" data-work-page="test-compare">
      <CompareToolbar :api="api" :ids="ids" :reference-name="referenceName" :sort="sort" @sort="sort = $event" @add="add" />
      <Alert v-if="dropped" variant="warning" role="status"><CircleAlert aria-hidden="true" /><AlertDescription>{{ t('results.compare.dropped', { count: dropped }) }}</AlertDescription></Alert>
      <Alert v-if="entries.some((entry) => !entry.run)" variant="warning" role="status"><CircleAlert aria-hidden="true" /><AlertDescription>{{ t('results.compare.loadFailed') }} <Button variant="link" class="h-auto p-0" @click="refresh">{{ t('runs.refresh') }}</Button></AlertDescription></Alert>
      <div v-if="loading && !entries.length" class="grid gap-3" aria-busy="true"><span class="sr-only">{{ t('results.compare.loading') }}</span><Skeleton class="h-48 w-full rounded-2xl" /><Skeleton class="h-80 w-full rounded-2xl" /></div>
      <div v-else-if="visible.length < 2" class="flex min-h-72 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed p-6 text-center"><GitCompareArrows class="size-8 text-muted-foreground" aria-hidden="true" /><h2 class="text-lg font-semibold">{{ t('results.compare.needTwo') }}</h2><Button as-child variant="outline"><NuxtLink to="/tests">{{ t('results.testsPageTitle') }}</NuxtLink></Button></div>
      <template v-else>
        <CompareLeaderboard :entries="visible" :ids="ids" :reference="reference" :hovered-id="hoveredId" @hover="hoveredId = $event" @jump="jump" />
        <TabsContent value="cards">
          <div :class="styles.scroller" tabindex="0" :aria-label="t('results.compare.cardsAndPlots')">
            <CompareCard v-for="(entry, index) in cards" :key="entry.id" :entry="entry" :reference="reference" :color="seriesColor(ids.indexOf(entry.id))" :highlighted="hoveredId === entry.id" :parameters="parameters.map((row) => ({ name: row.name, value: row.values[index] ?? null }))" @hover="hoveredId = $event" @reference="replace(ids, $event)" @remove="replace(ids.filter((id) => id !== $event))" />
          </div>
          <p class="mt-1 text-xs text-muted-foreground">{{ t('results.compare.scrollHint') }}</p>
        </TabsContent>
        <TabsContent value="table"><CompareTable :entries="ranked" :ids="ids" :reference-id="query.ref" /></TabsContent>
      </template>
    </Tabs>
  </MotionConfig>
</template>

<style scoped>
.comparison-container { container: comparison / inline-size; }
@container comparison (min-width: 640px) {
  .compare-scroller { scroll-padding-left: 316px; }
  .compare-scroller > .is-reference { position: sticky; left: 0; z-index: 10; scroll-snap-align: none; box-shadow: var(--tw-ring-shadow, 0 0 transparent), 10px 0 18px -12px color-mix(in oklab, var(--foreground) 30%, transparent); }
}
@container comparison (max-width: 639px) {
  .compare-scroller { grid-auto-columns: 86%; }
}
</style>
