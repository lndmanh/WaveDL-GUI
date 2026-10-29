<script setup lang="ts">
import { computed, nextTick, shallowRef, toRaw, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Check, Plus, RefreshCw, Search, Sparkles } from '@lucide/vue';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { customModelSchema } from '../../../shared/schemas/training-request';
import type { ConnectionSession } from '../../lib/connection-session';
import type { DatasetInspection } from '../../lib/dataset-inspection';
import { CatalogApi, type ModelDescription, type ModelSelection } from '../../lib/catalog-api';
import {
  entryModel,
  loadRecentModels,
  modelEntries,
  modelEntryKey,
  rememberRecentModel,
  type ModelEntry,
} from '../../lib/model-entries';
import { modelShapeGuidance } from '../../lib/model-shape-guidance';
import { browserStorage } from '../../lib/preferences';
import type { CatalogueMessage } from '../../composables/useModelCatalogue';
import { modelCategoryMessageKeys } from '../../i18n/dynamic-keys';
import { mappedMessageKey, modelTierMessageKeys } from '../catalog/model-facets';
import InspectorPanel from './InspectorPanel.vue';
import ModelDetail from './ModelDetail.vue';
import SegmentedControl from './SegmentedControl.vue';

const props = defineProps<{
  session: ConnectionSession;
  models: readonly ModelDescription[];
  busy: boolean;
  message: CatalogueMessage;
  selection: ModelSelection | null;
  pretrained: boolean;
  inspection: DatasetInspection | null;
  singleChannel: boolean;
  disabled: boolean;
}>();
const emit = defineEmits<{
  choose: [model: ModelDescription, pretrained: boolean];
  custom: [selection: ModelSelection];
  reload: [];
}>();
const { t } = useI18n({ useScope: 'global' });
const listId = useId();
const searchId = useId();
const customId = useId();
const tiers = ['Edge', 'Low', 'Medium', 'High'] as const;
type Fit = 'fits' | 'all';
type Tier = 'any' | (typeof tiers)[number];

const query = shallowRef('');
const fit = shallowRef<Fit>('fits');
const tier = shallowRef<Tier>('any');
const highlighted = shallowRef<string | null>(null);
const weightChoices = shallowRef<Readonly<Record<string, boolean>>>({});
const recents = shallowRef<string[]>(loadRecentModels(browserStorage()));
const customOpen = shallowRef(false);
const customValue = shallowRef('');
const customError = shallowRef('');
const customBusy = shallowRef(false);

const entries = computed(() => modelEntries(props.models));
const selectedKey = computed(() =>
  props.selection && props.selection.source !== 'custom'
    ? modelEntryKey(props.selection.model)
    : null,
);
function weightsFor(entry: ModelEntry): boolean {
  const choice = weightChoices.value[entry.key];
  if (choice !== undefined) return choice;
  return entry.key === selectedKey.value ? props.pretrained && !!entry.weighted : false;
}
function fits(entry: ModelEntry): boolean {
  return [entry.scratch, entry.weighted].some(
    (model) =>
      !!model &&
      modelShapeGuidance(props.inspection, model, props.singleChannel).status !== 'mismatch',
  );
}
const inspected = computed(() => (props.inspection?.inputShape.length ?? 0) > 0);
const matching = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();
  return entries.value.filter((entry) => {
    const model = entry.primary;
    const haystack = [
      model.displayName,
      entry.key,
      model.category,
      model.architectureFamily,
      model.shortDescription,
      ...model.tags,
    ]
      .join(' ')
      .toLocaleLowerCase();
    return (
      (!needle || haystack.includes(needle)) &&
      (tier.value === 'any' || model.computeTier === tier.value)
    );
  });
});
const fitting = computed(() => matching.value.filter(fits));
const visible = computed(() =>
  inspected.value && fit.value === 'fits' ? fitting.value : matching.value,
);
const categoryOrder = Object.keys(modelCategoryMessageKeys);
const groups = computed(() => {
  const recentEntries = recents.value.flatMap((key) =>
    visible.value.filter((entry) => entry.key === key),
  );
  const byCategory = new Map<string, ModelEntry[]>();
  for (const entry of visible.value)
    byCategory.set(entry.primary.category, [
      ...(byCategory.get(entry.primary.category) ?? []),
      entry,
    ]);
  const ordered = [...byCategory.entries()].sort(
    ([a], [b]) =>
      (categoryOrder.indexOf(a) + 1 || 99) - (categoryOrder.indexOf(b) + 1 || 99) ||
      a.localeCompare(b),
  );
  return [
    ...(recentEntries.length && !query.value
      ? [{ id: 'recent', label: t('builder.recent'), entries: recentEntries }]
      : []),
    ...ordered.map(([category, items]) => ({
      id: category,
      label: (() => {
        const key = mappedMessageKey(modelCategoryMessageKeys, category);
        return key ? t(key) : category;
      })(),
      entries: [...items].sort((a, b) => a.primary.paramsM - b.primary.paramsM),
    })),
  ];
});
const flat = computed(() => groups.value.flatMap((group) => group.entries));
const current = computed(
  () =>
    flat.value.find((entry) => entry.key === highlighted.value) ??
    entries.value.find((entry) => entry.key === highlighted.value) ??
    flat.value[0] ??
    null,
);

watch(
  [selectedKey, entries],
  ([key]) => {
    if (key && (!highlighted.value || !entries.value.some((e) => e.key === highlighted.value)))
      highlighted.value = key;
  },
  { immediate: true },
);

function optionId(entry: ModelEntry, group: string): string {
  return `${listId}-${group.replace(/[^A-Za-z0-9]/g, '')}-${entry.key}`;
}
/** Rows, not entries: a recent model is listed twice and each copy is its own option. */
const rows = computed(() =>
  groups.value.flatMap((group) =>
    group.entries.map((entry) => ({ entry, id: optionId(entry, group.id) })),
  ),
);
const cursor = shallowRef<string | null>(null);
function highlight(entry: ModelEntry, group: string) {
  highlighted.value = entry.key;
  cursor.value = optionId(entry, group);
}
function navigate(event: KeyboardEvent) {
  const list = rows.value;
  if (!list.length) return;
  if (event.key === 'Enter' && current.value) {
    event.preventDefault();
    choose(current.value);
    return;
  }
  const index = Math.max(
    0,
    list.findIndex((row) => row.id === activeDescendant.value),
  );
  const next =
    event.key === 'ArrowDown'
      ? Math.min(list.length - 1, index + 1)
      : event.key === 'ArrowUp'
        ? Math.max(0, index - 1)
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? list.length - 1
            : null;
  const row = next === null ? undefined : list[next];
  if (!row) return;
  event.preventDefault();
  highlighted.value = row.entry.key;
  cursor.value = row.id;
  void nextTick(() => document.getElementById(row.id)?.scrollIntoView({ block: 'nearest' }));
}
function setWeights(entry: ModelEntry, value: boolean) {
  weightChoices.value = { ...weightChoices.value, [entry.key]: value };
}
function choose(entry: ModelEntry) {
  if (props.disabled) return;
  const weights = weightsFor(entry) && !!entry.weighted;
  recents.value = rememberRecentModel(browserStorage(), entry.key);
  emit('choose', entryModel(entry, weights), weights);
}
const activeDescendant = computed(() => {
  const key = current.value?.key;
  const matches = rows.value.filter((row) => row.entry.key === key);
  return (matches.find((row) => row.id === cursor.value) ?? matches[0])?.id;
});
const tierOptions = computed<{ value: Tier; label: string }[]>(() => [
  { value: 'any', label: t('builder.anySize') },
  ...tiers.map((value) => {
    const key = mappedMessageKey(modelTierMessageKeys, value);
    return { value, label: key ? t(key) : value };
  }),
]);
const currentSelected = computed(() => {
  const entry = current.value;
  if (!entry || entry.key !== selectedKey.value || !props.selection) return false;
  return props.selection.model === entryModel(entry, weightsFor(entry)).id;
});

async function useCustom() {
  customError.value = '';
  const parsed = customModelSchema.safeParse({ modelId: customValue.value.trim() });
  if (!parsed.success) {
    customError.value = parsed.error.issues[0]?.message ?? t('project.customModelFailed');
    return;
  }
  customBusy.value = true;
  try {
    emit(
      'custom',
      await new CatalogApi(toRaw(props.session)).selectCustomModel(parsed.data.modelId),
    );
    customOpen.value = false;
  } catch {
    customError.value = t('project.customModelFailed');
  } finally {
    customBusy.value = false;
  }
}
</script>
<template>
  <InspectorPanel :title="t('builder.modelTitle')" title-hidden>
    <div class="model-toolbar">
      <div class="relative min-w-40 flex-1">
        <Search
          class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          :id="searchId"
          v-model="query"
          type="search"
          class="h-9 w-full rounded-xl bg-surface pl-9"
          :placeholder="t('builder.searchModels')"
          :aria-label="t('catalog.findModel')"
          :disabled="busy"
          data-testid="model-search"
        />
      </div>
      <SegmentedControl
        v-if="inspected"
        v-model="fit"
        :label="t('builder.compatibility')"
        :options="[
          { value: 'fits', label: t('builder.fitsData', { count: fitting.length }) },
          { value: 'all', label: t('builder.allModels', { count: matching.length }) },
        ]"
      />
      <Select v-model="tier">
        <SelectTrigger
          class="h-9 w-36 rounded-xl bg-surface"
          :aria-label="t('catalog.filterTier')"
          data-testid="model-size-filter"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem v-for="option in tierOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        :aria-label="t('catalog.reloadCatalog')"
        :title="t('catalog.reloadCatalog')"
        :disabled="busy"
        @click="emit('reload')"
      >
        <RefreshCw :class="busy ? 'animate-spin' : ''" aria-hidden="true" />
      </Button>
    </div>

    <Alert v-if="message" role="alert">
      <AlertTitle>{{ t('catalog.catalogStatus') }}</AlertTitle>
      <AlertDescription class="flex flex-wrap items-center gap-3">
        {{ t(message) }}
        <Button type="button" size="sm" variant="outline" @click="emit('reload')">
          {{ t('catalog.reloadCatalog') }}
        </Button>
      </AlertDescription>
    </Alert>

    <div class="surface-group model-browser">
      <div class="model-browser-list">
        <p v-if="busy" role="status" class="sr-only">{{ t('catalog.readingModels') }}</p>
        <div v-if="busy" class="flex flex-col gap-2 p-3" aria-hidden="true">
          <Skeleton v-for="index in 8" :key="index" class="h-8 w-full rounded-lg" />
        </div>
        <div
          v-else-if="flat.length"
          :id="listId"
          role="listbox"
          tabindex="0"
          class="model-browser-scroll"
          :aria-label="t('catalog.modelCatalog')"
          :aria-activedescendant="activeDescendant"
          @keydown="navigate"
        >
          <div v-for="group in groups" :key="group.id" role="group" :aria-label="group.label">
            <p class="model-browser-heading" aria-hidden="true">{{ group.label }}</p>
            <div
              v-for="entry in group.entries"
              :id="optionId(entry, group.id)"
              :key="`${group.id}-${entry.key}`"
              role="option"
              class="model-browser-row"
              :aria-selected="optionId(entry, group.id) === activeDescendant"
              :data-model-entry="entry.key"
              :data-dim="inspected && !fits(entry) ? true : undefined"
              data-testid="model-card"
              @click="highlight(entry, group.id)"
              @dblclick="choose(entry)"
            >
              <span class="min-w-0 flex-1 truncate">{{ entry.primary.displayName }}</span>
              <Sparkles
                v-if="entry.weighted"
                class="model-browser-glyph"
                :aria-label="t('catalog.pretrained')"
              />
              <span class="model-browser-size">{{ entry.primary.paramsM }}M</span>
              <Check
                v-if="entry.key === selectedKey"
                class="model-browser-check"
                :aria-label="t('builder.modelInUse')"
              />
            </div>
          </div>
        </div>
        <p v-else-if="!message" role="status" class="p-6 text-center text-sm text-muted-foreground">
          {{ t('catalog.noModels') }}
        </p>
        <div class="model-browser-footer">
          <Button
            v-if="!customOpen"
            type="button"
            variant="ghost"
            size="sm"
            class="w-full justify-start text-primary"
            :disabled="disabled"
            @click="customOpen = true"
          >
            <Plus aria-hidden="true" />{{ t('builder.customModel') }}
          </Button>
          <div v-else class="flex flex-col gap-2 p-1">
            <label :for="customId" class="text-xs font-medium">
              {{ t('project.customModelRegistryId') }}
            </label>
            <div class="flex gap-2">
              <Input
                :id="customId"
                v-model="customValue"
                class="h-8 font-mono text-xs"
                autocomplete="off"
                spellcheck="false"
                :aria-invalid="!!customError"
                @keydown.enter.prevent="useCustom"
              />
              <Button type="button" size="sm" :disabled="customBusy || disabled" @click="useCustom">
                {{ t('builder.use') }}
              </Button>
            </div>
            <FieldError v-if="customError" :errors="[customError]" />
            <p class="text-xs text-muted-foreground">{{ t('project.customModelHelp') }}</p>
          </div>
        </div>
      </div>

      <div class="model-browser-detail" aria-live="polite">
        <div
          v-if="selection?.source === 'custom'"
          class="mb-6 rounded-xl bg-primary/8 px-4 py-3 text-sm"
          role="status"
          data-testid="selected-model"
        >
          {{ t('builder.customInUse', { model: selection.model }) }}
        </div>
        <ModelDetail
          v-if="current"
          :entry="current"
          :weights="weightsFor(current)"
          :selected="currentSelected"
          :inspection="inspection"
          :single-channel="singleChannel"
          :disabled="disabled || busy"
          @update:weights="setWeights(current, $event)"
          @choose="choose(current)"
        />
        <p v-if="!current && !busy" class="text-sm text-muted-foreground">
          {{ t('builder.pickModelHint') }}
        </p>
      </div>
    </div>
  </InspectorPanel>
</template>
<style>
.model-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.model-browser {
  display: grid;
  grid-template-columns: minmax(15rem, 19rem) minmax(0, 1fr);
  min-height: 34rem;
  overflow: hidden;
}
.model-browser-list {
  display: flex;
  min-height: 0;
  flex-direction: column;
  border-right: 0.5px solid color-mix(in srgb, var(--foreground) 12%, transparent);
  background: color-mix(in srgb, var(--foreground) 2%, transparent);
}
.model-browser-scroll {
  flex: 1;
  max-height: 34rem;
  overflow-y: auto;
  padding: 0.4rem 0.5rem 0.75rem;
  outline: none;
}
.model-browser-scroll:focus-visible {
  box-shadow: inset 0 0 0 2px var(--primary);
}
.model-browser-heading {
  position: sticky;
  top: -0.4rem;
  z-index: 1;
  padding: 0.75rem 0.6rem 0.3rem;
  color: var(--muted-foreground);
  font-size: 0.68rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: linear-gradient(var(--surface) 70%, transparent);
}
.model-browser-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.42rem 0.6rem;
  border-radius: 0.55rem;
  font-size: 0.86rem;
  cursor: default;
  user-select: none;
}
.model-browser-row:hover:not([aria-selected='true']) {
  background: color-mix(in srgb, var(--foreground) 5%, transparent);
}
.model-browser-row[aria-selected='true'] {
  color: var(--primary-foreground);
  background: var(--primary);
}
.model-browser-row[data-dim] {
  opacity: 0.45;
}
.model-browser-size {
  color: var(--muted-foreground);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}
.model-browser-row[aria-selected='true'] .model-browser-size {
  color: inherit;
  opacity: 0.8;
}
.model-browser-glyph {
  width: 0.8rem;
  height: 0.8rem;
  flex: none;
  opacity: 0.55;
}
.model-browser-check {
  width: 0.9rem;
  height: 0.9rem;
  flex: none;
  color: var(--primary);
}
.model-browser-row[aria-selected='true'] .model-browser-check {
  color: inherit;
}
.model-browser-footer {
  padding: 0.4rem;
  border-top: 0.5px solid color-mix(in srgb, var(--foreground) 12%, transparent);
}
.model-browser-detail {
  min-width: 0;
  padding: 1.75rem 2rem 2rem;
}
@media (max-width: 48rem) {
  .model-browser {
    grid-template-columns: minmax(0, 1fr);
  }
  .model-browser-list {
    border-right: 0;
    border-bottom: 0.5px solid color-mix(in srgb, var(--foreground) 12%, transparent);
  }
  .model-browser-scroll {
    max-height: 18rem;
  }
  .model-browser-detail {
    padding: 1.25rem;
  }
}
</style>
