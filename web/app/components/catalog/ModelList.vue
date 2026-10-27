<script setup lang="ts">
import { computed } from 'vue';
import { Button } from '@/components/ui/button';
import type { ModelDescription } from '../../lib/catalog-api';
import type { DatasetInspection } from '../../lib/dataset-inspection';
import { modelShapeGuidance } from '../../lib/model-shape-guidance';
import { catalogMessages } from '../../i18n/catalog';
import { modelPresentation } from '../../i18n/model-descriptions';
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
const props = defineProps<{
  models: readonly ModelDescription[];
  busy: boolean;
  inspection?: DatasetInspection | null;
  singleChannel?: boolean;
}>();
const { t, locale, translateKnownMessage } = useWorkstationI18n(catalogMessages);
const presentations = computed(() =>
  props.models.map((model) => ({
    model,
    text: modelPresentation(model, locale.value),
    guidance: modelShapeGuidance(props.inspection, model, props.singleChannel),
  })),
);
const emit = defineEmits<{ select: [model: ModelDescription] }>();
</script>
<template>
  <ul class="flex flex-col gap-5" :aria-label="t('modelDescriptions')">
    <li
      v-for="{ model, text, guidance } in presentations"
      :key="model.id"
      class="flex flex-col gap-2"
    >
      <h3>{{ model.displayName }} · {{ model.id }}</h3>
      <p>
        {{ translateKnownMessage(model.category) }} ·
        {{ t('dimensions', { dims: model.supportedDims.join(', ') })
        }}{{ model.pretrained ? t('pretrained') : '' }}
      </p>
      <p>{{ text.description }}</p>
      <p>{{ t('bestFor', { description: text.bestFor }) }}</p>
      <p
        class="text-sm"
        :class="guidance.status === 'mismatch' ? 'text-destructive' : 'text-muted-foreground'"
      >
        {{
          t(`shape_${guidance.status}`, {
            shape: guidance.shape,
            dims: guidance.dimensions,
          })
        }}
      </p>
      <p v-if="text.untranslated" class="text-muted-foreground">{{ t('untranslated') }}</p>
      <Button
        variant="outline"
        class="self-start"
        :disabled="busy"
        @click="emit('select', model)"
        >{{ t('chooseModelName', { name: model.displayName }) }}</Button
      >
    </li>
  </ul>
</template>
