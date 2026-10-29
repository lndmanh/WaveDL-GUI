<script setup lang="ts">
import { computed, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { Check, CircleAlert, CircleCheck, Info } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { DatasetInspection } from '../../lib/dataset-inspection';
import { entryModel, type ModelEntry } from '../../lib/model-entries';
import { modelShapeGuidance } from '../../lib/model-shape-guidance';
import { modelPresentation } from '../../i18n/model-descriptions';
import { modelCategoryMessageKeys, shapeGuidanceMessageKeys } from '../../i18n/dynamic-keys';
import { mappedMessageKey, modelFamilyMessageKeys, modelTierMessageKeys } from '../catalog/model-facets';

const props = defineProps<{
  entry: ModelEntry;
  weights: boolean;
  selected: boolean;
  inspection: DatasetInspection | null;
  singleChannel: boolean;
  disabled: boolean;
}>();
const emit = defineEmits<{ 'update:weights': [value: boolean]; choose: [] }>();
const { t, locale } = useI18n({ useScope: 'global' });
const weightsId = useId();
const tiers = ['Edge', 'Low', 'Medium', 'High'];

const model = computed(() => entryModel(props.entry, props.weights));
const text = computed(() =>
  modelPresentation(model.value, locale.value === 'vi' ? 'vi' : 'en', t),
);
const guidance = computed(() =>
  modelShapeGuidance(props.inspection, model.value, props.singleChannel),
);
const dataDims = computed(() => props.inspection?.inputShape.length ?? 0);
const category = computed(() => {
  const key = mappedMessageKey(modelCategoryMessageKeys, model.value.category);
  return key ? t(key) : model.value.category;
});
const family = computed(() => {
  const key = mappedMessageKey(modelFamilyMessageKeys, model.value.architectureFamily);
  return key ? t(key) : model.value.architectureFamily;
});
const tier = computed(() => {
  const key = mappedMessageKey(modelTierMessageKeys, model.value.computeTier);
  return key ? t(key) : model.value.computeTier;
});
const title = computed(() => props.entry.primary.displayName.replace(/ \(Pretrained\)$/, ''));
const tierLevel = computed(() => tiers.indexOf(model.value.computeTier) + 1);
// Bundled translations cover pros only; cons stay in the daemon's English.
const cons = computed(() => (locale.value === 'en' ? model.value.cons.slice(0, 3) : []));
const shapeNote = computed(() =>
  t(shapeGuidanceMessageKeys[guidance.value.status], {
    shape: guidance.value.shape,
    dims: guidance.value.dimensions,
  }),
);
const megabytes = computed(() =>
  model.value.sizeMb >= 1000
    ? `${(model.value.sizeMb / 1000).toFixed(1)} GB`
    : `${Math.round(model.value.sizeMb)} MB`,
);
</script>
<template>
  <article class="flex min-w-0 flex-col gap-6" :aria-label="title">
    <header class="flex flex-wrap items-start gap-4">
      <div class="min-w-[min(100%,16rem)] flex-1">
        <p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {{ category }} · {{ family }}
        </p>
        <h3 class="mt-1 text-[1.65rem] leading-tight font-semibold tracking-[-0.025em]">
          {{ title }}
        </h3>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ model.authorInstitution }} · {{ model.yearPublished }}
          <span class="font-mono text-xs">· {{ model.id }}</span>
        </p>
      </div>
      <Button
        type="button"
        size="lg"
        class="model-detail-choose"
        :variant="selected ? 'secondary' : 'default'"
        :disabled="disabled || selected"
        data-testid="model-select"
        @click="emit('choose')"
      >
        <Check v-if="selected" aria-hidden="true" />
        {{ selected ? t('builder.modelInUse') : t('builder.useThisModel') }}
      </Button>
    </header>

    <p class="max-w-[62ch] text-[0.95rem] leading-relaxed">{{ text.bestFor }}</p>

    <dl class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      <div class="model-stat">
        <dt>{{ t('builder.parameters') }}</dt>
        <dd>{{ t('builder.millions', { value: model.paramsM }) }}</dd>
      </div>
      <div class="model-stat">
        <dt>{{ t('builder.weightsSize') }}</dt>
        <dd>{{ megabytes }}</dd>
      </div>
      <div class="model-stat">
        <dt>{{ t('builder.compute') }}</dt>
        <dd class="flex items-center gap-2">
          <span class="flex gap-0.5" aria-hidden="true">
            <i v-for="level in 4" :key="level" class="model-tier" :data-on="level <= tierLevel" />
          </span>
          <span class="text-sm">{{ tier }}</span>
        </dd>
      </div>
      <div class="model-stat">
        <dt>{{ t('builder.inputs') }}</dt>
        <dd class="flex gap-1">
          <span
            v-for="dims in model.supportedDims"
            :key="dims"
            class="model-dim"
            :data-match="dims === dataDims"
            >{{ dims }}D</span
          >
        </dd>
      </div>
    </dl>

    <div
      v-if="entry.weighted"
      class="surface-group surface-row"
      :data-testid="`model-weights-${entry.key}`"
    >
      <div class="min-w-0 flex-1">
        <label :for="weightsId" class="text-[0.9rem] font-medium">
          {{ t('builder.startFromImagenet') }}
        </label>
        <p class="text-xs text-muted-foreground">
          {{
            t('builder.weightsHelp', {
              dims: entry.weighted.supportedDims.map((value) => `${value}D`).join(' · '),
            })
          }}
        </p>
      </div>
      <Switch
        :id="weightsId"
        :model-value="weights"
        :disabled="disabled"
        @update:model-value="emit('update:weights', $event === true)"
      />
    </div>

    <div
      v-if="inspection"
      class="model-fit"
      :data-status="guidance.status"
      role="note"
    >
      <CircleCheck v-if="guidance.status === 'described'" aria-hidden="true" />
      <CircleAlert v-else-if="guidance.status === 'mismatch'" aria-hidden="true" />
      <Info v-else aria-hidden="true" />
      <p>{{ shapeNote }}</p>
    </div>

    <div class="grid gap-6 sm:grid-cols-2">
      <section v-if="text.pros.length">
        <h4 class="model-list-title text-success">{{ t('builder.goodAt') }}</h4>
        <ul class="model-points">
          <li v-for="pro in text.pros" :key="pro">{{ pro }}</li>
        </ul>
      </section>
      <section v-if="cons.length">
        <h4 class="model-list-title text-warning">{{ t('builder.watchOut') }}</h4>
        <ul class="model-points">
          <li v-for="con in cons" :key="con">{{ con }}</li>
        </ul>
      </section>
    </div>
    <p v-if="text.untranslated" class="text-xs text-muted-foreground">
      {{ t('catalog.untranslated') }}
    </p>
  </article>
</template>
<style>
.model-detail-choose {
  min-width: 10rem;
  border-radius: 0.8rem;
}
.model-stat {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.7rem 0.85rem;
  border-radius: 0.8rem;
  background: color-mix(in srgb, var(--foreground) 4.5%, transparent);
}
.model-stat dt {
  color: var(--muted-foreground);
  font-size: 0.72rem;
}
.model-stat dd {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.model-tier {
  display: block;
  width: 0.9rem;
  height: 0.35rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--foreground) 14%, transparent);
}
.model-tier[data-on='true'] {
  background: var(--primary);
}
.model-dim {
  padding: 0.05rem 0.4rem;
  border-radius: 0.4rem;
  font-size: 0.85rem;
  background: color-mix(in srgb, var(--foreground) 7%, transparent);
}
.model-dim[data-match='true'] {
  color: var(--primary-foreground);
  background: var(--primary);
}
.model-fit {
  display: flex;
  gap: 0.6rem;
  padding: 0.75rem 0.9rem;
  border-radius: 0.8rem;
  font-size: 0.82rem;
  line-height: 1.45;
  background: color-mix(in srgb, var(--foreground) 4%, transparent);
}
.model-fit svg {
  flex: none;
  width: 1rem;
  height: 1rem;
  margin-top: 0.1rem;
}
.model-fit[data-status='described'] {
  background: color-mix(in srgb, var(--success) 9%, transparent);
}
.model-fit[data-status='described'] svg {
  color: var(--success);
}
.model-fit[data-status='mismatch'] {
  background: color-mix(in srgb, var(--warning) 11%, transparent);
}
.model-fit[data-status='mismatch'] svg {
  color: var(--warning);
}
.model-list-title {
  margin-bottom: 0.5rem;
  font-size: 0.7rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.model-points {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  font-size: 0.85rem;
  line-height: 1.45;
}
.model-points li {
  position: relative;
  padding-left: 0.9rem;
}
.model-points li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.55em;
  width: 0.3rem;
  height: 0.3rem;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.35;
}
</style>
