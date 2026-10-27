<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button } from '@/components/ui/button';
import type { ModelDescription } from '../../lib/catalog-api';
import type { DatasetInspection } from '../../lib/dataset-inspection';
import { modelShapeGuidance } from '../../lib/model-shape-guidance';
import { modelPresentation } from '../../i18n/model-descriptions';
import { modelCategoryMessageKeys, shapeGuidanceMessageKeys } from '../../i18n/dynamic-keys';
const props = defineProps<{
  models: readonly ModelDescription[];
  busy: boolean;
  inspection?: DatasetInspection | null;
  singleChannel?: boolean;
}>();
const { t, locale } = useI18n({ useScope: 'global' });
function categoryLabel(category: string): string {
  const key = Object.hasOwn(modelCategoryMessageKeys, category)
    ? modelCategoryMessageKeys[category as keyof typeof modelCategoryMessageKeys]
    : undefined;
  return key ? t(key) : category;
}
const presentations = computed(() =>
  props.models.map((model) => ({
    model,
    text: modelPresentation(model, locale.value === 'vi' ? 'vi' : 'en', t),
    guidance: modelShapeGuidance(props.inspection, model, props.singleChannel),
  })),
);
const emit = defineEmits<{ select: [model: ModelDescription] }>();
</script>
<template>
  <ul class="flex flex-col gap-5" :aria-label="t('catalog.modelDescriptions')">
    <li
      v-for="{ model, text, guidance } in presentations"
      :key="model.id"
      class="flex flex-col gap-2"
    >
      <h3>{{ model.displayName }} · {{ model.id }}</h3>
      <p>
        {{ categoryLabel(model.category) }} ·
        {{ t('catalog.dimensions', { dims: model.supportedDims.join(', ') })
        }}{{ model.pretrained ? t('catalog.pretrained') : '' }}
      </p>
      <p>{{ text.description }}</p>
      <p>{{ t('catalog.bestFor', { description: text.bestFor }) }}</p>
      <p
        class="text-sm"
        :class="guidance.status === 'mismatch' ? 'text-destructive' : 'text-muted-foreground'"
      >
        {{
          t(shapeGuidanceMessageKeys[guidance.status], {
            shape: guidance.shape,
            dims: guidance.dimensions,
          })
        }}
      </p>
      <p v-if="text.untranslated" class="text-muted-foreground">{{ t('catalog.untranslated') }}</p>
      <Button
        variant="outline"
        class="self-start"
        :disabled="busy"
        @click="emit('select', model)"
        >{{ t('catalog.chooseModelName', { name: model.displayName }) }}</Button
      >
    </li>
  </ul>
</template>
