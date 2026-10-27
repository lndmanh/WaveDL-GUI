<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { Button } from '@/components/ui/button';
import { projectGuideMessageKeys } from '../../i18n/dynamic-keys';

const { t } = useI18n({ useScope: 'global' });
defineProps<{ enabled: boolean; step: number; busy: boolean }>();
defineEmits<{ toggle: []; previous: []; next: [] }>();
const steps = projectGuideMessageKeys;
</script>
<template>
  <nav :aria-label="t('project.guidedTrainingAuthoring')" class="flex flex-col gap-4">
    <Button
      type="button"
      variant="outline"
      class="self-start"
      :disabled="busy"
      @click="$emit('toggle')"
      >{{ t(enabled ? 'project.showFullEditor' : 'project.useGuidedSteps') }}</Button
    ><template v-if="enabled"
      ><ol class="flex flex-wrap gap-3">
        <li
          v-for="(label, index) in steps"
          :key="label"
          :aria-current="index === step ? 'step' : undefined"
          :class="index === step ? 'font-medium' : 'text-muted-foreground'"
        >
          {{ index + 1 }}. {{ t(label) }}
        </li>
      </ol>
      <p>
        {{ t('project.guideHelp') }}
      </p>
      <div class="flex gap-3">
        <Button
          type="button"
          variant="outline"
          :disabled="busy || step === 0"
          @click="$emit('previous')"
          >{{ t('project.previousStep') }}</Button
        ><Button
          type="button"
          variant="outline"
          :disabled="busy || step >= 4"
          @click="$emit('next')"
          >{{ t('project.nextStep') }}</Button
        >
      </div></template
    >
  </nav>
</template>
