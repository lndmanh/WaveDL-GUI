<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, toRaw, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import InfoChip from '../common/InfoChip.vue';
import type { ConnectionSession } from '../../lib/connection-session';
import type { DatasetInspection } from '../../lib/dataset-inspection';
import { CatalogApi, type ModelDescription, type ModelSelection } from '../../lib/catalog-api';
import ModelList from './ModelList.vue';
import { modelCategoryMessageKeys } from '../../i18n/dynamic-keys';
import { mappedMessageKey, modelFamilyMessageKeys, modelTierMessageKeys } from './model-facets';

const { t } = useI18n({ useScope: 'global' });
const props = defineProps<{
  session: ConnectionSession;
  inspection?: DatasetInspection | null;
  singleChannel?: boolean;
}>();
const emit = defineEmits<{ select: [selection: ModelSelection] }>();
const searchId = useId();
const models = shallowRef<readonly ModelDescription[]>([]);
const query = shallowRef('');
const busy = shallowRef(false);
const message = shallowRef<'' | 'catalog.modelsUnavailable' | 'catalog.connectionChanged'>('');
const selectedFamilies = shallowRef<readonly string[]>([]);
const selectedTiers = shallowRef<readonly string[]>([]);
const selectedDimensions = shallowRef<readonly number[]>([]);
const selectedCategories = shallowRef<readonly string[]>([]);
const pretrainedOnly = shallowRef(false);

function categoryLabel(category: string): string {
  const key = modelCategoryMessageKeys[category as keyof typeof modelCategoryMessageKeys];
  return key ? t(key) : category;
}

const categories = computed(() =>
  [...new Set(models.value.map((model) => model.category))].sort((a, b) =>
    categoryLabel(a).localeCompare(categoryLabel(b)),
  ),
);
const families = computed(() =>
  [...new Set(models.value.map((model) => model.architectureFamily))].sort(),
);
const tierOrder = Object.keys(modelTierMessageKeys);
const tiers = computed(() =>
  [...new Set(models.value.map((model) => model.computeTier))].sort(
    (a, b) => tierOrder.indexOf(a) - tierOrder.indexOf(b),
  ),
);
const dimensions = computed(() =>
  [...new Set(models.value.flatMap((model) => model.supportedDims))].sort((a, b) => a - b),
);
const filterCount = computed(
  () =>
    selectedFamilies.value.length +
    selectedTiers.value.length +
    selectedDimensions.value.length +
    selectedCategories.value.length +
    (pretrainedOnly.value ? 1 : 0) +
    (query.value.trim() ? 1 : 0),
);
const filtered = computed(() => {
  const normalized = query.value.trim().toLocaleLowerCase();
  return models.value.filter((model) => {
    const haystack = [
      model.displayName,
      model.id,
      model.category,
      model.architectureFamily,
      model.computeTier,
      model.shortDescription,
      model.tags.join(' '),
    ]
      .join(' ')
      .toLocaleLowerCase();
    return (
      (!normalized || haystack.includes(normalized)) &&
      (!selectedFamilies.value.length ||
        selectedFamilies.value.includes(model.architectureFamily)) &&
      (!selectedTiers.value.length || selectedTiers.value.includes(model.computeTier)) &&
      (!selectedDimensions.value.length ||
        selectedDimensions.value.some((dimension) => model.supportedDims.includes(dimension))) &&
      (!selectedCategories.value.length || selectedCategories.value.includes(model.category)) &&
      (!pretrainedOnly.value || model.pretrained)
    );
  });
});
let revision = 0;
let request: AbortController | null = null;
let unsubscribe: (() => void) | undefined;

function toggleString(target: { value: readonly string[] }, value: string) {
  target.value = target.value.includes(value)
    ? target.value.filter((item) => item !== value)
    : [...target.value, value];
}
function toggleFamily(value: string) {
  toggleString(selectedFamilies, value);
}
function toggleTier(value: string) {
  toggleString(selectedTiers, value);
}
function toggleCategory(value: string) {
  toggleString(selectedCategories, value);
}

function toggleDimension(value: number) {
  selectedDimensions.value = selectedDimensions.value.includes(value)
    ? selectedDimensions.value.filter((item) => item !== value)
    : [...selectedDimensions.value, value];
}

function clearFilters() {
  query.value = '';
  selectedFamilies.value = [];
  selectedTiers.value = [];
  selectedDimensions.value = [];
  selectedCategories.value = [];
  pretrainedOnly.value = false;
}

function familyLabel(family: string): string {
  const key = mappedMessageKey(modelFamilyMessageKeys, family);
  return key ? t(key) : family;
}

function tierLabel(tier: string): string {
  const key = mappedMessageKey(modelTierMessageKeys, tier);
  return key ? t(key) : tier;
}

function cancel() {
  revision++;
  request?.abort();
  request = null;
  busy.value = false;
}

async function load() {
  cancel();
  const current = revision;
  request = new AbortController();
  busy.value = true;
  message.value = '';
  models.value = [];
  try {
    const value = await new CatalogApi(toRaw(props.session)).models(request.signal);
    if (current === revision) models.value = value;
  } catch {
    if (current === revision) message.value = 'catalog.modelsUnavailable';
  } finally {
    if (current === revision) {
      busy.value = false;
      request = null;
    }
  }
}

function select(model: ModelDescription) {
  try {
    // `model` is intentionally passed through untouched: CatalogApi brands the frozen object.
    emit('select', new CatalogApi(toRaw(props.session)).selectModel(model, models.value));
  } catch {
    models.value = [];
    message.value = 'catalog.connectionChanged';
  }
}

watch(
  () => toRaw(props.session),
  (session) => {
    unsubscribe?.();
    cancel();
    models.value = [];
    let scope = -1;
    let connected = false;
    unsubscribe = session.subscribe((state) => {
      if (state.revision === scope && connected && state.status === 'connected') return;
      scope = state.revision;
      connected = state.status === 'connected';
      cancel();
      models.value = [];
      if (state.status === 'connected') {
        message.value = '';
        void load();
      } else if (state.status !== 'disconnected') message.value = 'catalog.modelsUnavailable';
    });
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  unsubscribe?.();
  cancel();
});
</script>
<template>
  <section class="flex flex-col gap-4" :aria-label="t('catalog.modelCatalog')">
    <h2>{{ t('catalog.chooseModel') }}</h2>
    <Alert
      ><AlertTitle
        ><InfoChip
          :label="t('catalog.certification')"
          :text="t('catalog.modelSafety')"
          uncertain /></AlertTitle
    ></Alert>
    <Field>
      <FieldLabel :for="searchId">{{ t('catalog.findModel') }}</FieldLabel>
      <Input :id="searchId" v-model="query" :disabled="busy" data-testid="model-search" />
      <FieldDescription>{{ t('catalog.searchHelp') }}</FieldDescription>
    </Field>
    <div v-if="models.length" class="facet-panel" role="group" :aria-label="t('catalog.filterBy')">
      <div class="facet-group">
        <span class="facet-label">{{ t('catalog.filterFamily') }}</span>
        <Button
          v-for="family in families"
          :key="family"
          size="sm"
          :variant="selectedFamilies.includes(family) ? 'secondary' : 'outline'"
          :aria-pressed="selectedFamilies.includes(family)"
          data-testid="facet-family"
          @click="toggleFamily(family)"
          >{{ familyLabel(family) }}</Button
        >
      </div>
      <div class="facet-group">
        <span class="facet-label">{{ t('catalog.filterTier') }}</span>
        <Button
          v-for="tier in tiers"
          :key="tier"
          size="sm"
          :variant="selectedTiers.includes(tier) ? 'secondary' : 'outline'"
          :aria-pressed="selectedTiers.includes(tier)"
          data-testid="facet-tier"
          @click="toggleTier(tier)"
          >{{ tierLabel(tier) }}</Button
        >
      </div>
      <div class="facet-group">
        <span class="facet-label">{{ t('catalog.filterDimension') }}</span>
        <Button
          v-for="dimension in dimensions"
          :key="dimension"
          size="sm"
          :variant="selectedDimensions.includes(dimension) ? 'secondary' : 'outline'"
          :aria-pressed="selectedDimensions.includes(dimension)"
          data-testid="facet-dimension"
          @click="toggleDimension(dimension)"
          >{{ dimension }}D</Button
        >
      </div>
      <div class="facet-group">
        <span class="facet-label">{{ t('catalog.filterCategory') }}</span>
        <Button
          v-for="category in categories"
          :key="category"
          size="sm"
          :variant="selectedCategories.includes(category) ? 'secondary' : 'outline'"
          :aria-pressed="selectedCategories.includes(category)"
          data-testid="facet-category"
          @click="toggleCategory(category)"
          >{{ categoryLabel(category) }}</Button
        >
      </div>
      <div class="facet-group">
        <Button
          size="sm"
          :variant="pretrainedOnly ? 'secondary' : 'outline'"
          :aria-pressed="pretrainedOnly"
          data-testid="facet-pretrained"
          @click="pretrainedOnly = !pretrainedOnly"
          >{{ t('catalog.filterPretrained') }}</Button
        >
        <Button v-if="filterCount" size="sm" variant="ghost" @click="clearFilters">
          {{ t('catalog.clearFilters') }}
        </Button>
      </div>
    </div>
    <Alert v-if="message" role="alert">
      <AlertTitle>{{ t('catalog.catalogStatus') }}</AlertTitle>
      <AlertDescription>{{ t(message) }}</AlertDescription>
    </Alert>
    <p v-if="busy" role="status">{{ t('catalog.readingModels') }}</p>
    <div v-if="busy" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      <Skeleton v-for="index in 3" :key="index" class="h-52 w-full" />
    </div>
    <div v-else-if="models.length" class="catalog-summary">
      <Badge variant="outline">{{ t('catalog.modelCount', { count: filtered.length }) }}</Badge>
    </div>
    <ModelList
      :models="filtered"
      :busy="busy"
      :inspection="inspection"
      :single-channel="singleChannel"
      @select="select"
    />
    <Empty v-if="!busy && !filtered.length && !message"
      ><EmptyDescription>{{ t('catalog.noModels') }}</EmptyDescription></Empty
    >
    <div class="flex flex-wrap gap-3">
      <Button variant="outline" :disabled="busy" @click="load">{{
        t('catalog.reloadCatalog')
      }}</Button>
      <Button v-if="busy" variant="outline" @click="cancel">{{ t('catalog.stopLoading') }}</Button>
    </div>
  </section>
</template>
<style scoped>
.facet-panel {
  display: flex;
  flex-wrap: wrap;
  gap: 0.8rem 1rem;
  align-items: center;
}
.facet-group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: center;
}
.facet-label {
  color: var(--muted-foreground);
  font-size: 0.8rem;
  font-weight: 600;
}
.catalog-summary {
  min-height: 1.5rem;
}
</style>
