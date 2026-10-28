<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Info, Sparkles } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ModelDescription } from '../../lib/catalog-api';
import type { DatasetInspection } from '../../lib/dataset-inspection';
import { modelShapeGuidance } from '../../lib/model-shape-guidance';
import { modelPresentation } from '../../i18n/model-descriptions';
import { modelCategoryMessageKeys, shapeGuidanceMessageKeys } from '../../i18n/dynamic-keys';
import InfoChip from '../common/InfoChip.vue';
import {
  mappedMessageKey,
  modelFamilyMessageKeys,
  modelShapeLabelMessageKeys,
  modelTierMessageKeys,
} from './model-facets';

const props = defineProps<{
  models: readonly ModelDescription[];
  busy: boolean;
  inspection?: DatasetInspection | null;
  singleChannel?: boolean;
}>();
const emit = defineEmits<{ select: [model: ModelDescription] }>();
const { t, locale } = useI18n({ useScope: 'global' });

function categoryLabel(category: string): string {
  const key = Object.hasOwn(modelCategoryMessageKeys, category)
    ? modelCategoryMessageKeys[category as keyof typeof modelCategoryMessageKeys]
    : undefined;
  return key ? t(key) : category;
}

function familyLabel(family: string): string {
  const key = mappedMessageKey(modelFamilyMessageKeys, family);
  return key ? t(key) : family;
}

function tierLabel(tier: string): string {
  const key = mappedMessageKey(modelTierMessageKeys, tier);
  return key ? t(key) : tier;
}

const presentations = computed(() =>
  props.models.map((model) => {
    const guidance = modelShapeGuidance(props.inspection, model, props.singleChannel);
    return {
      model,
      text: modelPresentation(model, locale.value === 'vi' ? 'vi' : 'en', t),
      guidance,
      shapeLabelKey: mappedMessageKey(modelShapeLabelMessageKeys, guidance.status),
      shapeNote: t(shapeGuidanceMessageKeys[guidance.status], {
        shape: guidance.shape,
        dims: guidance.dimensions,
      }),
    };
  }),
);
</script>
<template>
  <ul class="model-grid" data-testid="model-grid" :aria-label="t('catalog.modelDescriptions')">
    <li
      v-for="{ model, text, guidance, shapeLabelKey, shapeNote } in presentations"
      :key="model.id"
    >
      <Card class="model-card" data-testid="model-card">
        <CardHeader class="model-card-header">
          <CardTitle>{{ model.displayName }} · {{ model.id }}</CardTitle>
          <div class="model-badges">
            <Badge variant="outline">{{ familyLabel(model.architectureFamily) }}</Badge>
            <Badge variant="secondary">{{ tierLabel(model.computeTier) }}</Badge>
            <Badge variant="outline">
              {{ t('catalog.parameterCount', { value: model.paramsM }) }}
            </Badge>
            <Badge v-if="model.pretrained" variant="outline">
              <Sparkles aria-hidden="true" />{{ t('catalog.pretrained') }}
            </Badge>
          </div>
          <CardDescription v-if="text.shortDescription">
            {{ text.shortDescription }}
          </CardDescription>
        </CardHeader>
        <CardContent class="model-card-content">
          <div
            class="model-dimensions"
            :aria-label="t('catalog.dimensions', { dims: model.supportedDims.join(', ') })"
          >
            <Badge v-for="dimension in model.supportedDims" :key="dimension" variant="outline">
              {{ dimension }}D
            </Badge>
            <Badge variant="outline">{{ categoryLabel(model.category) }}</Badge>
          </div>
          <div class="shape-summary">
            <InfoChip
              :label="shapeLabelKey ? t(shapeLabelKey) : t('catalog.shapeUnknown')"
              :text="shapeNote"
              uncertain
            />
            <span v-if="guidance.shape" class="text-muted-foreground">
              {{ guidance.shape }} · {{ guidance.dimensions }}D
            </span>
          </div>
          <div class="model-actions">
            <Popover>
              <PopoverTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  :aria-label="t('catalog.modelDetails', { name: model.displayName })"
                  data-testid="model-details"
                >
                  <Info aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent>
                <div class="model-details">
                  <h4>{{ t('catalog.modelDetails', { name: model.displayName }) }}</h4>
                  <p>{{ text.description }}</p>
                  <p>{{ t('catalog.bestFor', { description: text.bestFor }) }}</p>
                  <p class="shape-detail">{{ shapeNote }}</p>
                  <p v-if="text.untranslated" class="text-muted-foreground">
                    {{ t('catalog.untranslated') }}
                  </p>
                  <template v-if="text.pros.length">
                    <h5>{{ t('catalog.strengths') }}</h5>
                    <ul>
                      <li v-for="pro in text.pros" :key="pro">{{ pro }}</li>
                    </ul>
                  </template>
                </div>
              </PopoverContent>
            </Popover>
            <Button
              variant="outline"
              :disabled="busy"
              data-testid="model-select"
              @click="emit('select', model)"
            >
              {{ t('catalog.chooseModelName', { name: model.displayName }) }}
            </Button>
          </div>
        </CardContent>
      </Card>
    </li>
  </ul>
</template>
<style scoped>
.model-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
  gap: 1rem;
  list-style: none;
  margin: 0;
  padding: 0;
}
.model-card {
  height: 100%;
  gap: 1rem;
  padding: 1.25rem;
  min-width: 0;
  max-width: 100%;
}
.model-grid > li {
  min-width: 0;
}
.model-card :deep([data-slot='card-title']) {
  overflow-wrap: anywhere;
}
.model-actions :deep(button) {
  white-space: normal;
  max-width: 100%;
  min-width: 0;
  height: auto;
  min-height: 2.25rem;
}
.model-card :deep([data-slot='badge']) {
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
}
.model-card-header,
.model-card-content {
  padding: 0;
}
.model-badges,
.model-dimensions,
.model-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
}
.model-card-content {
  display: flex;
  min-height: 10rem;
  flex-direction: column;
  gap: 0.85rem;
}
.shape-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.82rem;
}
.model-actions {
  margin-top: auto;
  justify-content: flex-end;
}
.model-details h4,
.model-details h5 {
  margin: 0 0 0.5rem;
}
.model-details p {
  margin: 0 0 0.75rem;
}
.shape-detail {
  border-left: 2px solid var(--border);
  padding-left: 0.75rem;
  color: var(--muted-foreground);
}
.model-details ul {
  margin: 0;
  padding-left: 1.25rem;
}
</style>
