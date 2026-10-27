<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, toRaw, useId, watch } from 'vue';
import { Button } from '@/components/ui/button';
import type { Artifact } from '../../lib/artifact-client';
import type { ConnectionSession } from '../../lib/connection-session';
import { loadCvSummary, type CvMetric, type CvSummary } from '../../lib/cv-summary';
import { useI18n } from 'vue-i18n';
const props = defineProps<{ session: ConnectionSession; artifacts: readonly Artifact[] }>();
const { t, locale } = useI18n({ useScope: 'global' });
const id = useId();
const publications = computed(() =>
  props.artifacts.filter((artifact) => artifact.path === 'cv_summary.json'),
);
const selected = shallowRef<Artifact | null>(null);
const summary = shallowRef<CvSummary | null>(null);
const busy = shallowRef(false);
const failed = shallowRef(false);
let scope = new AbortController();
let epoch = 0;
function reset() {
  scope.abort();
  scope = new AbortController();
  epoch++;
  selected.value = null;
  summary.value = null;
  busy.value = false;
  failed.value = false;
}
watch(() => props.artifacts, reset);
watch(
  () => toRaw(props.session),
  (session, _prior, onCleanup) => {
    reset();
    let revision = session.snapshot().revision;
    const unsubscribe = session.subscribe((state) => {
      if (state.status !== 'connected' || revision !== state.revision) reset();
      revision = state.revision;
    });
    onCleanup(unsubscribe);
  },
  { immediate: true },
);
function choose(event: Event) {
  if (!(event.target instanceof HTMLSelectElement)) return;
  const generation = event.target.value;
  const artifact = publications.value.find((item) => item.generation === generation);
  scope.abort();
  scope = new AbortController();
  epoch++;
  selected.value = artifact ?? null;
  summary.value = null;
  busy.value = false;
  failed.value = false;
}
async function load() {
  if (!selected.value || busy.value) return;
  const current = epoch;
  busy.value = true;
  failed.value = false;
  try {
    const result = await loadCvSummary(props.session, selected.value, scope.signal);
    if (current === epoch) summary.value = result;
  } catch {
    if (current === epoch) failed.value = true;
  } finally {
    if (current === epoch) busy.value = false;
  }
}
function number(value: CvMetric) {
  return value === null
    ? t('cv.unavailable')
    : new Intl.NumberFormat(locale.value === 'vi' ? 'vi-VN' : 'en-US', {
        maximumSignificantDigits: 6,
      }).format(value);
}
const overall = computed(() =>
  summary.value
    ? [
        { label: t('cv.r2'), mean: summary.value.r2_mean, std: summary.value.r2_std },
        { label: t('cv.mae'), mean: summary.value.mae_mean, std: summary.value.mae_std },
        { label: t('cv.loss'), mean: summary.value.val_loss_mean, std: summary.value.val_loss_std },
      ]
    : [],
);
onBeforeUnmount(() => {
  reset();
});
</script>
<template>
  <section v-if="publications.length" class="flex flex-col gap-4" :aria-labelledby="`${id}-title`">
    <h3 :id="`${id}-title`" class="text-lg font-semibold">{{ t('cv.title') }}</h3>
    <p class="text-sm text-muted-foreground">{{ t('cv.help') }}</p>
    <label :for="`${id}-source`">{{ t('cv.publication') }}</label>
    <select
      :id="`${id}-source`"
      :disabled="busy"
      :value="selected?.generation ?? ''"
      @change="choose"
    >
      <option value="">{{ t('cv.choose') }}</option>
      <option
        v-for="artifact in publications"
        :key="artifact.generation"
        :value="artifact.generation"
      >
        {{ t('cv.source', { generation: artifact.generation, attempt: artifact.attempt }) }}
      </option>
    </select>
    <Button variant="outline" :disabled="!selected || busy" @click="load">{{
      busy ? t('cv.loading') : t('cv.load')
    }}</Button>
    <p v-if="failed" role="alert">{{ t('cv.failed') }}</p>
    <template v-if="summary">
      <p>
        {{
          t('cv.timestamp', {
            timestamp: new Date(summary.timestamp).toLocaleString(
              locale === 'vi' ? 'vi-VN' : 'en-US',
            ),
          })
        }}
      </p>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <caption>
            {{
              t('cv.overall')
            }}
          </caption>
          <thead>
            <tr>
              <th>{{ t('cv.metric') }}</th>
              <th>{{ t('cv.mean') }}</th>
              <th>{{ t('cv.std') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in overall" :key="row.label">
              <th>{{ row.label }}</th>
              <td>{{ number(row.mean) }}</td>
              <td>{{ number(row.std) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <caption>
            {{
              t('cv.folds')
            }}
          </caption>
          <thead>
            <tr>
              <th>{{ t('cv.fold') }}</th>
              <th>{{ t('cv.r2') }}</th>
              <th>{{ t('cv.mae') }}</th>
              <th>{{ t('cv.normalized') }}</th>
              <th>{{ t('cv.loss') }}</th>
              <th>{{ t('cv.bestEpoch') }}</th>
              <th>{{ t('cv.epochs') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="fold in summary.fold_results" :key="fold.fold">
              <th>{{ fold.fold }}</th>
              <td>{{ number(fold.r2) }}</td>
              <td>{{ number(fold.mae_physical) }}</td>
              <td>{{ number(fold.mae_normalized) }}</td>
              <td>{{ number(fold.best_val_loss) }}</td>
              <td>{{ fold.best_epoch }}</td>
              <td>{{ fold.epochs_trained }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-for="fold in summary.fold_results" :key="fold.fold" class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <caption>
            {{
              t('cv.targets')
            }}
            ·
            {{
              t('cv.fold')
            }}
            {{
              fold.fold
            }}
          </caption>
          <thead>
            <tr>
              <th>{{ t('cv.metric') }}</th>
              <th>{{ t('cv.r2') }}</th>
              <th>{{ t('cv.mae') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="target in fold.targets" :key="target.index">
              <th>{{ t('cv.parameter', { index: target.index }) }}</th>
              <td>{{ number(target.r2) }}</td>
              <td>{{ number(target.mae) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>
